import base64
import hashlib
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.tests.test_backend import settings, login_session, repo

COMMIT = 'a' * 40
TREE = 'b' * 40
TEXT = b'export const title = "Accessible";\n'
BLOB = hashlib.sha1(f'blob {len(TEXT)}\0'.encode() + TEXT).hexdigest()


class GitHubMock:
    def __init__(self):
        self.calls = []
        self.jobs = []
        self.revoked = False
        self.installed = True
        self.user_id = 1
        self.truncated = False
        self.content = TEXT
        self.mode = '100644'
        self.size = len(TEXT)
        self.blob_status = 200
        self.webhook_status = 200
        self.branch = COMMIT

    def __call__(self, request):
        import json
        path = request.url.path
        self.calls.append(request)
        if path == '/user':
            return httpx.Response(200, json={'id': self.user_id, 'login': 'alice'})
        if path == '/user/installations':
            return httpx.Response(200, json={'installations': [] if self.revoked else [{'id': 3, 'app_id': 42}]})
        if path == '/user/installations/3/repositories':
            return httpx.Response(200, json={'repositories': [repo()]})
        if path == '/app/installations/3/access_tokens':
            assert json.loads(request.content) == {'repository_ids': [7], 'permissions': {'contents': 'read'}}
            return httpx.Response(201, json={'token': 'installation-secret'})
        if path == '/installation/repositories':
            return httpx.Response(200, json={'repositories': [repo()] if self.installed else []})
        if path == '/repositories/7/commits/main':
            return httpx.Response(200, json={'sha': self.branch, 'commit': {'tree': {'sha': TREE}}})
        if path == f'/repositories/7/git/trees/{TREE}':
            assert request.url.params['recursive'] == '1'
            assert request.headers['authorization'] == 'Bearer installation-secret'
            return httpx.Response(200, json={'sha': TREE, 'truncated': self.truncated, 'tree': [
                {'path': 'src/app.tsx', 'type': 'blob', 'mode': self.mode, 'sha': BLOB, 'size': self.size},
                {'path': '.env', 'type': 'blob', 'mode': '100644', 'sha': 'c'*40, 'size': 10},
                {'path': 'node_modules/lib.js', 'type': 'blob', 'mode': '100644', 'sha': 'c'*40, 'size': 10},
                {'path': 'src/credentials.json', 'type': 'blob', 'mode': '100644', 'sha': 'c'*40, 'size': 10},
                {'path': 'src/submodule', 'type': 'commit', 'mode': '160000', 'sha': 'c'*40},
                {'path': 'src/link.tsx', 'type': 'blob', 'mode': '120000', 'sha': 'c'*40, 'size': 10}]})
        if path == f'/repositories/7/git/blobs/{BLOB}':
            return httpx.Response(self.blob_status, json={'encoding': 'base64', 'size': self.size,
                'content': base64.b64encode(self.content).decode()})
        if path == '/webhook/test':
            assert request.headers['x-accesspilot-secret'] == 'webhook-secret'
            self.jobs.append(json.loads(request.content))
            return httpx.Response(self.webhook_status, json={})
        raise AssertionError(f'Unexpected upstream path: {path}')


@pytest.fixture
def service(settings, monkeypatch):
    async def public(url):
        pass
    monkeypatch.setattr('backend.main.validate_website', public)
    upstream = GitHubMock()
    app = create_app(settings, httpx.MockTransport(upstream))
    with TestClient(app) as client:
        login_session(app, client)
        yield app, client, upstream


def submit(client):
    response = client.post('/audits', json={'website_url': 'https://example.com',
        'installation_id': 3, 'repository_id': 7}, headers={
            'Origin': 'http://localhost:3000', 'X-CSRF-Token': 'csrf',
            'Idempotency-Key': __import__('uuid').uuid4().hex})
    if response.status_code == 202:
        client.portal.call(client.app.state.audit_queue.queue.join)
    return response


def job_request(client, payload, endpoint='tree', **kwargs):
    return client.get(payload['source_service'][f'{endpoint}_path'], headers={
        'Authorization': 'Bearer ' + payload['source_service']['credential']}, **kwargs)


def test_submission_and_pinned_source(service):
    app, client, upstream = service
    response = submit(client)
    assert response.status_code == 202
    payload = upstream.jobs[0]
    assert payload['base_sha'] == COMMIT
    assert payload['source_service']['credential'] not in response.text
    job = app.state.jobs.get(response.json()['job_id'])
    assert job['credential_hash'] != payload['source_service']['credential']
    assert job['owner_user_id'] == 1
    # A branch advance does not change the job's snapshot.
    upstream.branch = 'd' * 40
    response = job_request(client, payload)
    assert response.status_code == 200
    assert response.json()['files'] == [{'path': 'src/app.tsx', 'sha': BLOB, 'size': len(TEXT)}]
    response = job_request(client, payload, 'source', params={'path': 'src/app.tsx', 'ref': 'other', 'repository_id': 999})
    assert response.status_code == 200
    assert response.json()['text'] == TEXT.decode()
    assert response.json()['base_sha'] == COMMIT
    assert 'installation-secret' not in response.text and 'user-token' not in response.text
    assert len([r for r in upstream.calls if r.url.path.endswith('/commits/main')]) == 1


@pytest.mark.parametrize('endpoint', ['tree', 'source'])
def test_browser_cookies_and_wrong_machine_credentials_denied(service, endpoint):
    _, client, upstream = service
    assert submit(client).status_code == 202
    payload = upstream.jobs[0]
    path = payload['source_service'][f'{endpoint}_path']
    before = len(upstream.calls)
    assert client.get(path, params={'path': 'src/app.tsx'}).status_code == 401
    assert client.get(path, headers={'Authorization': 'Bearer wrong'}, params={'path': 'src/app.tsx'}).status_code == 403
    assert len(upstream.calls) == before


def test_cross_job_credential_denied(service):
    _, client, upstream = service
    assert submit(client).status_code == 202
    assert submit(client).status_code == 202
    first, second = upstream.jobs
    response = client.get(second['source_service']['tree_path'], headers={
        'Authorization': 'Bearer ' + first['source_service']['credential']})
    assert response.status_code == 403


@pytest.mark.parametrize('reason', ['logout', 'session_expired', 'job_expired', 'revoked', 'uninstalled', 'wrong_owner', 'identity'])
def test_authorization_rechecked(service, reason):
    app, client, upstream = service
    assert submit(client).status_code == 202
    payload = upstream.jobs[0]
    if reason == 'logout':
        assert client.post('/auth/logout', headers={'Origin': 'http://localhost:3000', 'X-CSRF-Token': 'csrf'}).status_code == 200
    elif reason == 'session_expired':
        app.state.sessions.items['test-session']['expires'] = time.time() - 1
    elif reason == 'job_expired':
        app.state.jobs.items[payload['job_id']]['expires'] = time.time() - 1
    elif reason == 'revoked':
        upstream.revoked = True
    elif reason == 'uninstalled':
        upstream.installed = False
    elif reason == 'wrong_owner':
        app.state.sessions.items['test-session']['user']['id'] = 2
    else:
        upstream.user_id = 2
    assert job_request(client, payload).status_code == 403


@pytest.mark.parametrize('path', ['../src/app.tsx', '/src/app.tsx', '.env', 'src/credentials.json',
    'node_modules/lib.js', 'src/link.tsx', 'src/submodule', 'src/missing.tsx', 'src\\app.tsx', 'src//app.tsx'])
def test_path_policy(service, path):
    _, client, upstream = service
    assert submit(client).status_code == 202
    response = job_request(client, upstream.jobs[0], 'source', params={'path': path})
    assert response.status_code in (403, 404)
    assert not any('/git/blobs/' in r.url.path for r in upstream.calls)


@pytest.mark.parametrize('case', ['truncated', 'oversize', 'symlink', 'tampered', 'binary', 'upstream_expired'])
def test_limits_and_blob_failures(service, case):
    _, client, upstream = service
    assert submit(client).status_code == 202
    if case == 'truncated':
        upstream.truncated = True
    elif case == 'oversize':
        upstream.size = 256 * 1024 + 1
    elif case == 'symlink':
        upstream.mode = '120000'
    elif case == 'tampered':
        upstream.content = b'x' * len(TEXT)
    elif case == 'binary':
        upstream.content = b'\x00' * len(TEXT)
    else:
        upstream.blob_status = 401
    response = job_request(client, upstream.jobs[0], 'source', params={'path': 'src/app.tsx'})
    assert response.status_code == {'truncated': 413, 'oversize': 404, 'symlink': 404,
                                   'tampered': 422, 'binary': 422, 'upstream_expired': 401}[case]


def test_failed_dispatch_revokes_job_credential(service):
    app, client, upstream = service
    upstream.webhook_status = 500
    response = submit(client)
    assert response.status_code == 202
    assert app.state.jobs.get(response.json()['job_id'])['status'] == 'failed'
    assert job_request(client, upstream.jobs[0]).status_code == 403
