import asyncio
import copy
import json
import threading
import sys

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.audit_scans import ScanFailure, normalize_audit
from backend.main import create_app
from backend.tests.test_backend import settings, login_session
from backend.tests.test_job_sources import GitHubMock

BODY = {'website_url': 'https://example.com', 'installation_id': 3, 'repository_id': 7}
HEADERS = {'Origin': 'http://localhost:3000', 'X-CSRF-Token': 'csrf', 'Idempotency-Key': 'scan-1'}


@pytest.fixture
def scan_app(settings, monkeypatch):
    async def public(url):
        pass
    monkeypatch.setattr('backend.main.validate_website', public)
    upstream = GitHubMock()
    def factory(scanner):
        return create_app(settings, httpx.MockTransport(upstream), scanner=scanner), upstream
    return factory


def test_normalization_preserves_native_evidence(axe_report):
    result = normalize_audit(axe_report, BODY['website_url'])
    assert result['violations'] == axe_report['violations']
    assert result['summary'] == {'violation_count': 1, 'affected_element_count': 1}
    assert result['testEngine'] == axe_report['testEngine']
    assert normalize_audit({'violations': []}, BODY['website_url'])['summary']['violation_count'] == 0


@pytest.mark.parametrize('broken', ['missing', 'id', 'selector', 'nodes', 'impact', 'evidence', 'nan', 'oversize'])
def test_invalid_reports_rejected(axe_report, broken):
    report = copy.deepcopy(axe_report)
    violation = report['violations'][0]
    if broken == 'missing':
        report = {}
    elif broken == 'id':
        violation.pop('id')
    elif broken == 'selector':
        violation['nodes'][0]['target'] = [123]
    elif broken == 'nodes':
        violation['nodes'] = []
    elif broken == 'impact':
        violation['impact'] = 'invented'
    elif broken == 'evidence':
        violation['nodes'][0]['any'] = 'wrong'
    elif broken == 'nan':
        report['bad'] = float('nan')
    else:
        report['bad'] = 'x' * (2*1024*1024)
    with pytest.raises(ScanFailure, match='invalid_report'):
        normalize_audit(report, BODY['website_url'])


def test_async_submission_and_idempotent_delivery(scan_app, axe_report):
    started, gate = threading.Event(), asyncio.Event()
    calls = []
    async def scanner(url):
        calls.append(url)
        started.set()
        await gate.wait()
        return axe_report
    app, upstream = scan_app(scanner)
    with TestClient(app) as client:
        login_session(app, client)
        first = client.post('/audits', json=BODY, headers=HEADERS)
        assert first.status_code == 202
        job_id = first.json()['job_id']
        assert started.wait(2)
        assert not upstream.jobs  # response already returned while scan is unfinished
        assert client.get(f'/audits/{job_id}').json()['status'] == 'scanning'
        second = client.post('/audits', json=BODY, headers=HEADERS)
        assert second.json()['job_id'] == job_id
        # A reused key with a different URL cannot silently select another job.
        assert client.post('/audits', json=dict(BODY, website_url='https://other.example'), headers=HEADERS).status_code == 409
        client.portal.call(gate.set)
        client.portal.call(app.state.audit_queue.queue.join)
        status = client.get(f'/audits/{job_id}').json()
        assert status['status'] == 'submitted'
        assert status['summary']['violation_count'] == 1
        payload = upstream.jobs[0]
        assert payload['audit']['violations'] == axe_report['violations']
        assert payload['job_id'] == job_id and payload['repository']['id'] == 7
        assert payload['base_sha'] == 'a'*40
        delivery = next(r for r in upstream.calls if r.url.path == '/webhook/test')
        assert delivery.headers['idempotency-key'] == job_id
        assert b'installation-secret' not in delivery.content and b'user-token' not in delivery.content
        again = client.post('/audits', json=BODY, headers=HEADERS)
        assert again.json()['job_id'] == job_id
        client.portal.call(app.state.audit_queue.queue.put_nowait, job_id)
        client.portal.call(app.state.audit_queue.queue.join)
        assert calls == [BODY['website_url']] and len(upstream.jobs) == 1
        # A different authenticated user cannot read another user's status.
        app.state.sessions.items['test-session']['user']['id'] = 2
        assert client.get(f'/audits/{job_id}').status_code == 404


@pytest.mark.parametrize('failure', ['crash', 'bad_report', 'timeout', 'revoked', 'logout'])
def test_background_failure_never_dispatches(scan_app, axe_report, monkeypatch, failure):
    async def scanner(url):
        if failure == 'crash':
            raise RuntimeError('private scanner details')
        if failure == 'bad_report':
            return {'wrong': []}
        if failure == 'timeout':
            await asyncio.sleep(1)
        if failure == 'revoked':
            upstream.revoked = True
        if failure == 'logout':
            app.state.sessions.items.clear()
        return axe_report
    monkeypatch.setattr('backend.audit_jobs.SCAN_TIMEOUT', .01)
    app, upstream = scan_app(scanner)
    with TestClient(app) as client:
        login_session(app, client)
        response = client.post('/audits', json=BODY, headers=HEADERS)
        assert response.status_code == 202
        client.portal.call(app.state.audit_queue.queue.join)
        job = app.state.jobs.get(response.json()['job_id'])
        assert job['status'] == 'failed' and job['credential_hash'] == ''
        assert job['error'] == {'crash': 'scanner_failed', 'bad_report': 'invalid_report',
            'timeout': 'scan_timed_out', 'revoked': 'authorization_failed',
            'logout': 'authorization_expired'}[failure]
        assert not upstream.jobs
        assert 'private scanner details' not in str(job)


def test_queue_and_concurrency_are_bounded(scan_app, axe_report, settings):
    settings.scan_concurrency = 1
    settings.scan_queue_size = 1
    gate, started = asyncio.Event(), threading.Event()
    active = peak = 0
    async def scanner(url):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        started.set()
        await gate.wait()
        active -= 1
        return axe_report
    app, upstream = scan_app(scanner)
    with TestClient(app) as client:
        login_session(app, client)
        assert client.post('/audits', json=BODY, headers=HEADERS).status_code == 202
        assert started.wait(2)
        assert client.post('/audits', json=BODY, headers=dict(HEADERS, **{'Idempotency-Key': 'scan-2'})).status_code == 202
        assert client.post('/audits', json=BODY, headers=dict(HEADERS, **{'Idempotency-Key': 'scan-3'})).status_code == 503
        client.portal.call(gate.set)
        client.portal.call(app.state.audit_queue.queue.join)
        assert peak == 1 and len(upstream.jobs) == 2


def test_scanner_still_writes_full_axe_report(tmp_path, axe_report, monkeypatch):
    from types import SimpleNamespace
    from backend import scanner
    from unittest.mock import MagicMock
    context, browser, playwright = MagicMock(), MagicMock(), MagicMock()
    browser.new_context.return_value = context
    playwright.chromium.launch.return_value = browser
    manager = MagicMock()
    manager.__enter__.return_value = playwright
    monkeypatch.setattr(scanner, 'sync_playwright', lambda: manager)
    axe = MagicMock()
    axe.run.return_value = SimpleNamespace(response=axe_report)
    monkeypatch.setattr(scanner, 'Axe', lambda: axe)
    output = tmp_path / 'audit.json'
    scanner.run_robust_scan('https://example.com', output_filename=str(output), proxy_url='http://127.0.0.1:1234')
    assert json.loads(output.read_text())['violations'] == axe_report['violations']
    options = playwright.chromium.launch.call_args.kwargs
    assert options['chromium_sandbox'] is True
    assert options['proxy']['bypass'] == '<-loopback>'
    assert context.route_web_socket.called
    assert browser.new_context.call_args.kwargs['service_workers'] == 'block'
    guard = context.route.call_args.args[1]
    for url, method in [('file:///etc/passwd', 'GET'), ('https://example.com', 'POST')]:
        route = MagicMock()
        route.request.url, route.request.method = url, method
        guard(route)
        route.abort.assert_called_once()


@pytest.mark.skipif(sys.platform == 'win32', reason='POSIX process-group implementation')
@pytest.mark.parametrize('result', ['success', 'missing_output', 'nonzero', 'timeout'])
def test_subprocess_adapter_isolates_environment_and_kills_process_group(monkeypatch, axe_report, result):
    from pathlib import Path
    from backend.audit_scans import ScannerRunner
    captured, killed = {}, []
    monkeypatch.setenv('GITHUB_PRIVATE_KEY', 'must-not-reach-scanner')
    monkeypatch.setenv('N8N_WEBHOOK_SECRET', 'must-not-reach-scanner')
    monkeypatch.setattr('backend.audit_scans.SCAN_TIMEOUT', .01)
    monkeypatch.setattr('backend.audit_scans.os.killpg', lambda pid, sig: killed.append(pid))
    class Proxy:
        url = 'http://127.0.0.1:12345'
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr('backend.audit_scans.PublicScanProxy', Proxy)
    class Process:
        pid = 123456789
        calls = 0
        async def wait(self):
            self.calls += 1
            if result == 'timeout' and self.calls == 1:
                await asyncio.sleep(1)
            return 1 if result == 'nonzero' else 0
    async def create(*args, **kwargs):
        captured.update(args=args, **kwargs)
        if result == 'success':
            Path(args[args.index('--output')+1]).write_text(json.dumps(axe_report))
        return Process()
    monkeypatch.setattr('backend.audit_scans.asyncio.create_subprocess_exec', create)
    async def run():
        if result == 'success':
            assert await ScannerRunner()('https://example.com') == axe_report
        else:
            with pytest.raises(ScanFailure):
                await ScannerRunner()('https://example.com')
    asyncio.run(run())
    assert 'GITHUB_PRIVATE_KEY' not in captured['env'] and 'N8N_WEBHOOK_SECRET' not in captured['env']
    assert captured['start_new_session'] is True
    assert killed == [123456789]
    assert not Path(captured['cwd']).exists()  # private audit.json and browser cache removed
