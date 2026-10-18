import asyncio
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.github_auth import Settings
from backend.main import create_app
from backend.run import server_options
from backend.security import RequestBoundary, MAX_REQUEST_BYTES, bounded_request
from backend.tests.test_backend import settings, login_session
from backend.tests.test_job_sources import GitHubMock, submit, job_request


@pytest.fixture
def tunnel(settings, monkeypatch):
    settings.tunnel_mode = True
    async def public(url):
        pass
    monkeypatch.setattr('backend.main.validate_website', public)
    upstream = GitHubMock()
    app = create_app(settings, httpx.MockTransport(upstream))
    with TestClient(app, base_url='http://localhost') as client:
        login_session(app, client)
        yield app, client, upstream


@pytest.mark.parametrize('path', ['/docs', '/docs/oauth2-redirect', '/redoc', '/openapi.json',
    '/.env', '/backend/.env', '/key.pem', '/backend/key.pem', '/.git/config',
    '/github/token', '/github/installations', '/github/private-key'])
def test_public_docs_and_sensitive_paths_absent(tunnel, path):
    app, client, _ = tunnel
    assert app.debug is False
    response = client.get(path)
    assert response.status_code == 404
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['x-content-type-options'] == 'nosniff'


def test_all_service_routes_require_job_authentication(tunnel):
    app, client, upstream = tunnel
    assert submit(client).status_code == 202
    job = upstream.jobs[0]
    routes = [r for r in app.routes if r.path.startswith('/service/jobs/')]
    assert {r.path for r in routes} == {'/service/jobs/{job_id}/tree', '/service/jobs/{job_id}/source'}
    for endpoint in ('tree', 'source'):
        path = job['source_service'][f'{endpoint}_path']
        params = {'path': 'src/app.tsx'}
        assert client.get(path, params=params).status_code == 401  # has browser cookie
        assert client.get(path, params=params, headers={'Authorization': 'Bearer invalid'}).status_code == 403
        response = job_request(client, job, endpoint, params=params)
        assert response.status_code == 200
        for secret in ('installation-secret', 'user-token', 'webhook-secret', job['source_service']['credential']):
            assert secret not in response.text


def test_cors_is_exact_and_proxy_headers_do_not_change_it(tunnel):
    _, client, _ = tunnel
    for origin, expected in [('http://localhost:3000', 200), ('https://evil.example', 400), ('null', 400)]:
        response = client.options('/audits', headers={'Origin': origin,
            'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-CSRF-Token',
            'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https'})
        assert response.status_code == expected
        assert response.headers.get('access-control-allow-origin') == (origin if expected == 200 else None)


@pytest.mark.parametrize('endpoint', ['/audits', '/auth/logout'])
@pytest.mark.parametrize('headers', [{}, {'Origin': 'https://evil.example', 'X-CSRF-Token': 'csrf'},
    {'Origin': 'http://localhost:3000'}, {'Origin': 'http://localhost:3000', 'X-CSRF-Token': 'wrong'}])
def test_all_browser_writes_require_origin_and_csrf(tunnel, endpoint, headers):
    _, client, _ = tunnel
    response = client.post(endpoint, headers=headers,
        json={'website_url': 'https://example.com', 'installation_id': 3, 'repository_id': 7})
    assert response.status_code == 403


def test_host_checks_and_server_proxy_policy(tunnel):
    _, client, _ = tunnel
    assert client.get('/health', headers={'Host': 'evil.example'}).status_code == 400
    assert client.get('/health', headers={'Host': 'example.trycloudflare.com',
        'Forwarded': 'for=1.2.3.4;host=evil.example;proto=https',
        'X-Forwarded-For': '1.2.3.4', 'CF-Connecting-IP': '1.2.3.4'}).status_code == 200
    options = server_options()
    assert options['host'] == '127.0.0.1'
    assert options['proxy_headers'] is False and options['access_log'] is False
    assert options['limit_concurrency'] == 32


def test_login_rate_limit_cannot_be_bypassed_with_forwarded_ip(tunnel):
    _, client, _ = tunnel
    for i in range(10):
        assert client.get('/auth/github/login', follow_redirects=False,
            headers={'CF-Connecting-IP': f'10.0.0.{i}'}).status_code == 307
    assert client.get('/auth/github/login', follow_redirects=False).status_code == 429


def test_errors_and_logs_do_not_disclose_credentials(settings, caplog):
    settings.tunnel_mode = True
    app = create_app(settings)
    @app.get('/explode')
    async def explode():
        raise RuntimeError('DO-NOT-LEAK-OAUTH-SECRET')
    with TestClient(app, base_url='http://localhost', raise_server_exceptions=False) as client:
        with caplog.at_level(logging.DEBUG):
            response = client.get('/explode?code=DO-NOT-LEAK-OAUTH-CODE')
            client.get('/auth/github/callback?state=bad&code=DO-NOT-LEAK-OAUTH-CODE')
            logging.getLogger('uvicorn.access').info('DO-NOT-LEAK-ACCESS-LOG')
            logging.getLogger('httpx').info('DO-NOT-LEAK-WIRE-LOG')
        assert response.status_code == 500
        assert 'DO-NOT-LEAK' not in response.text + caplog.text
        assert 'Traceback' not in response.text


def test_body_url_and_header_limits(tunnel):
    _, client, upstream = tunnel
    assert client.post('/audits', content=b'x'*(MAX_REQUEST_BYTES+1)).status_code == 413
    # The declared length cannot be used to bypass the actual byte limit.
    assert client.post('/audits', content=b'x'*(MAX_REQUEST_BYTES+1), headers={'Content-Length': '1'}).status_code == 413
    assert client.get('/health?'+'x'*4097).status_code == 414
    assert client.get('/health', headers={'X-Large': 'x'*16385}).status_code == 431
    assert not upstream.calls


def test_chunked_body_and_slow_body_limits(monkeypatch):
    async def run(slow=False):
        messages = []
        called = False
        async def app(scope, receive, send):
            nonlocal called
            called = True
        chunks = iter([b'x'*16384, b'x'*16384, b'x'])
        async def receive():
            if slow:
                await asyncio.sleep(.1)
            return {'type': 'http.request', 'body': next(chunks), 'more_body': True}
        async def send(message):
            messages.append(message)
        await RequestBoundary(app)({'type': 'http', 'path': '/audits', 'headers': [],
            'raw_path': b'/audits', 'query_string': b''}, receive, send)
        assert not called
        return messages[0]['status']
    assert asyncio.run(run()) == 413
    monkeypatch.setattr('backend.security.REQUEST_DEADLINE', .01)
    assert asyncio.run(run(slow=True)) == 504


def test_upstream_response_size_and_total_timeout(monkeypatch):
    class Stream(httpx.AsyncByteStream):
        async def __aiter__(self):
            yield b'x'*30
            yield b'x'*30
    async def run(slow=False):
        async def handler(request):
            if slow:
                await asyncio.sleep(.1)
            return httpx.Response(200, stream=Stream())
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            from fastapi import HTTPException
            with pytest.raises(HTTPException) as error:
                await bounded_request(client, 'GET', 'https://api.github.com/test', max_bytes=50)
            assert error.value.status_code == 502
    asyncio.run(run())
    monkeypatch.setattr('backend.security.UPSTREAM_DEADLINE', .01)
    asyncio.run(run(slow=True))


@pytest.mark.parametrize('origin', ['*', 'https://*.example.com', 'http://localhost:3000/',
    'http://user:password@localhost:3000', 'http://localhost:3000/path'])
def test_unsafe_cors_configuration_rejected(origin):
    with pytest.raises(ValueError, match='FRONTEND_ORIGIN'):
        create_app(Settings(frontend_origin=origin))


def test_private_key_content_is_never_returned(tunnel, monkeypatch):
    import hashlib
    from backend.tests import test_job_sources as source_tests
    _, client, upstream = tunnel
    content = b'export const key = "-----BEGIN RSA PRIVATE KEY-----";'
    blob = hashlib.sha1(f'blob {len(content)}\0'.encode() + content).hexdigest()
    monkeypatch.setattr(source_tests, 'BLOB', blob)
    upstream.content = content
    upstream.size = len(content)
    assert submit(client).status_code == 202
    response = job_request(client, upstream.jobs[0], 'source', params={'path': 'src/app.tsx'})
    assert response.status_code == 422
    assert 'BEGIN RSA PRIVATE KEY' not in response.text


def test_audit_deadline_revokes_pending_job(settings, monkeypatch):
    upstream = GitHubMock()
    async def public(url):
        pass
    async def handler(request):
        response = upstream(request)
        if request.url.path == '/webhook/test':
            await asyncio.sleep(.2)
        return response
    monkeypatch.setattr('backend.main.validate_website', public)
    monkeypatch.setattr('backend.security.UPSTREAM_DEADLINE', .05)
    app = create_app(settings, httpx.MockTransport(handler))
    with TestClient(app) as client:
        login_session(app, client)
        response = submit(client)
        assert response.status_code == 202
        assert upstream.jobs
        job = app.state.jobs.get(response.json()['job_id'])
        assert job['status'] == 'failed'
        assert job['error'] == 'dispatch_unknown'
        assert job['credential_hash'] == ''


@pytest.mark.parametrize('path', ['.env', '.env.local', 'config/.env', 'app.pem', 'keys/app.PEM'])
def test_source_policy_rejects_env_and_pem_files(path):
    from backend.job_sources import source_path
    assert not source_path(path)
