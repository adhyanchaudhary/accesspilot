import asyncio
from datetime import datetime
from types import SimpleNamespace

import certifi
import httpx
import pytest
from bson import ObjectId
from fastapi.testclient import TestClient
from pymongo.errors import PyMongoError

from backend import database
from backend.database import MongoScanRepository, PersistenceFailure
from backend.main import create_app
from backend.tests.test_backend import login_session, settings
from backend.tests.test_job_sources import GitHubMock

BODY = {'website_url': 'https://example.com', 'installation_id': 3, 'repository_id': 7}
HEADERS = {'Origin': 'http://localhost:3000', 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'mongo-1'}
SCAN_ID = '507f1f77bcf86cd799439011'


class MemoryScanStore:
    def __init__(self, failure=False):
        self.documents = []
        self.failure = failure
        self.closed = False

    async def save_scan(self, target_url, results, *, job_id=None):
        if self.failure:
            raise PersistenceFailure('insert failed')
        self.documents.append({'target_url': target_url, 'results': results, 'job_id': job_id,
                               'timestamp': datetime.now().astimezone()})
        return SCAN_ID

    def close(self):
        self.closed = True


def test_repository_uses_certifi_tls_and_returns_string_id(monkeypatch):
    captured = {}

    class Collection:
        async def insert_one(self, document):
            captured['document'] = document
            return SimpleNamespace(inserted_id=ObjectId(SCAN_ID))

    class Database:
        def __getitem__(self, name):
            assert name == 'scan_results'
            return Collection()

    class Client:
        def __init__(self, uri, **kwargs):
            captured['uri'] = uri
            captured['kwargs'] = kwargs

        def __getitem__(self, name):
            assert name == 'accesspilot'
            return Database()

        def close(self):
            captured['closed'] = True

    monkeypatch.setattr(database, 'AsyncIOMotorClient', Client)
    repository = MongoScanRepository('mongodb+srv://cluster.example/test', 'accesspilot')
    scan_id = asyncio.run(repository.save_scan(
        'https://example.com', {'violations': []}, job_id='job-1'))
    repository.close()

    assert scan_id == SCAN_ID
    assert captured['kwargs']['tlsCAFile'] == certifi.where()
    assert captured['kwargs']['appname'] == 'accesspilot'
    assert captured['document']['target_url'] == 'https://example.com'
    assert captured['document']['results'] == {'violations': []}
    assert captured['document']['job_id'] == 'job-1'
    assert isinstance(captured['document']['timestamp'], datetime)
    assert captured['closed'] is True


def test_repository_driver_failure_is_not_leaked(monkeypatch):
    class Collection:
        async def insert_one(self, document):
            raise PyMongoError('mongodb://user:password@cluster/private')

    class Client:
        def __init__(self, uri, **kwargs):
            pass

        def __getitem__(self, name):
            return {'scan_results': Collection()}

        def close(self):
            pass

    monkeypatch.setattr(database, 'AsyncIOMotorClient', Client)
    repository = MongoScanRepository('mongodb://localhost/test', 'accesspilot')
    with pytest.raises(PersistenceFailure) as error:
        asyncio.run(repository.save_scan('https://example.com', {'violations': []}))
    assert 'password' not in str(error.value)


def test_repository_rejects_non_mongodb_uri():
    with pytest.raises(ValueError):
        MongoScanRepository('https://example.com', 'accesspilot')


def test_scan_is_persisted_and_id_is_returned(settings, monkeypatch, axe_report):
    async def public(url):
        pass

    async def scanner(url):
        return axe_report

    monkeypatch.setattr('backend.main.validate_website', public)
    store = MemoryScanStore()
    upstream = GitHubMock()
    app = create_app(settings, httpx.MockTransport(upstream), scanner=scanner, scan_store=store)
    with TestClient(app) as client:
        login_session(app, client)
        response = client.post('/audits', json=BODY, headers=HEADERS)
        assert response.status_code == 202
        job_id = response.json()['job_id']
        client.portal.call(app.state.audit_queue.queue.join)
        status = client.get(f'/audits/{job_id}').json()
        assert status['status'] == 'submitted'
        assert status['scan_id'] == SCAN_ID
        assert store.documents[0]['target_url'] == BODY['website_url']
        assert store.documents[0]['results'] == axe_report
        assert store.documents[0]['job_id'] == job_id
    assert store.closed is True


def test_persistence_failure_blocks_dispatch(settings, monkeypatch, axe_report):
    async def public(url):
        pass

    async def scanner(url):
        return axe_report

    monkeypatch.setattr('backend.main.validate_website', public)
    store = MemoryScanStore(failure=True)
    upstream = GitHubMock()
    app = create_app(settings, httpx.MockTransport(upstream), scanner=scanner, scan_store=store)
    with TestClient(app) as client:
        login_session(app, client)
        response = client.post('/audits', json=BODY, headers=HEADERS)
        assert response.status_code == 202
        client.portal.call(app.state.audit_queue.queue.join)
        job = app.state.jobs.get(response.json()['job_id'])
        assert job['status'] == 'failed' and job['error'] == 'persistence_failed'
        assert job.get('scan_id') is None
    assert upstream.jobs == []
