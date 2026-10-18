import time
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from backend.github_auth import Settings, app_jwt
from backend.main import create_app


@pytest.fixture
def settings():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    return Settings(app_id='42', client_id='client', client_secret='secret', private_key=pem,
                    app_slug='accesspilot', n8n_webhook_url='https://example.app.n8n.cloud/webhook/test',
                    n8n_webhook_secret='webhook-secret')


def login_session(app, client):
    app.state.sessions.put('test-session', {'token': 'user-token', 'csrf': 'csrf',
        'user': {'id': 1, 'login': 'alice'}, 'expires': time.time() + 300})
    client.cookies.set('accesspilot_session', 'test-session')


def repo():
    return {'id': 7, 'full_name': 'alice/site', 'private': True, 'default_branch': 'main'}


def test_jwt(settings):
    token = app_jwt(settings)
    private = serialization.load_pem_private_key(settings.private_key.encode(), password=None)
    claims = jwt.decode(token, private.public_key(), algorithms=['RS256'], issuer='42')
    assert claims['exp'] - claims['iat'] == 600
    assert claims['iat'] <= time.time() < claims['exp']


def test_missing_and_bad_key():
    from fastapi import HTTPException
    for config in (Settings(), Settings(app_id='42', private_key='bad')):
        with pytest.raises(HTTPException) as error:
            app_jwt(config)
        assert error.value.status_code == 503


def test_login_callback_and_logout(settings):
    def handler(request):
        if request.url.path == '/login/oauth/access_token':
            assert b'code_verifier=' in request.content
            return httpx.Response(200, json={'access_token': 'private-user-token', 'expires_in': 3600})
        assert request.url.path == '/user'
        return httpx.Response(200, json={'id': 1, 'login': 'alice'})
    app = create_app(settings, httpx.MockTransport(handler))
    with TestClient(app) as client:
        response = client.get('/auth/github/login', follow_redirects=False)
        state = parse_qs(urlsplit(response.headers['location']).query)['state'][0]
        assert 'HttpOnly' in response.headers['set-cookie']
        assert client.get('/auth/github/callback?state=wrong&code=ok').status_code == 400
        # A stolen state without the binding cookie cannot log another browser in.
        other = TestClient(app)
        assert other.get(f'/auth/github/callback?state={state}&code=ok').status_code == 400
        response = client.get(f'/auth/github/callback?state={state}&code=ok', follow_redirects=False)
        assert response.status_code == 303
        assert 'private-user-token' not in response.text + str(response.headers)
        assert client.get(f'/auth/github/callback?state={state}&code=ok').status_code == 400
        me = client.get('/auth/github/me').json()
        assert me['user']['login'] == 'alice'
        assert client.post('/auth/logout').status_code == 403
        assert client.post('/auth/logout', headers={'Origin': settings.frontend_origin,
            'X-CSRF-Token': me['csrf_token']}).status_code == 200
        assert client.get('/auth/github/me').status_code == 401


def test_expired_state(settings):
    app = create_app(settings)
    app.state.states.put('old', {'binding': 'binding', 'expires': time.time() - 1})
    with TestClient(app) as client:
        client.cookies.set('accesspilot_oauth', 'binding')
        assert client.get('/auth/github/callback?state=old&code=x').status_code == 400


@pytest.mark.parametrize('unauthorized', ['installation', 'repository', 'app', 'suspended'])
def test_unauthorized_repository(settings, unauthorized):
    calls = []
    def handler(request):
        calls.append(request.url.path)
        if request.url.path == '/user/installations':
            installation = {'id': 3, 'app_id': 99 if unauthorized == 'app' else 42,
                            'suspended_at': 'today' if unauthorized == 'suspended' else None}
            return httpx.Response(200, json={'installations': [] if unauthorized == 'installation' else [installation]})
        return httpx.Response(200, json={'repositories': []})
    app = create_app(settings, httpx.MockTransport(handler))
    with TestClient(app) as client:
        login_session(app, client)
        response = client.post('/audits', json={'website_url': 'https://example.com',
            'installation_id': 3, 'repository_id': 7}, headers={
                'Origin': settings.frontend_origin, 'X-CSRF-Token': 'csrf'})
        assert response.status_code == 403
        assert not any('access_tokens' in path for path in calls)


def test_scoped_token_and_n8n(settings, monkeypatch):
    calls = []
    async def public(url):
        assert url == 'https://example.com'
    monkeypatch.setattr('backend.main.validate_website', public)
    def handler(request):
        import json
        calls.append(request.url.path)
        path = request.url.path
        if path == '/user/installations':
            return httpx.Response(200, json={'installations': [{'id': 3, 'app_id': 42}]})
        if path == '/app/installations/3/access_tokens':
            assert json.loads(request.content) == {'repository_ids': [7], 'permissions': {'contents': 'read'}}
            assert jwt.get_unverified_header(request.headers['authorization'].split()[1])['alg'] == 'RS256'
            return httpx.Response(201, json={'token': 'installation-secret', 'expires_at': '2099-01-01T00:00:00Z'})
        if path == '/webhook/test':
            assert request.headers['x-accesspilot-secret'] == 'webhook-secret'
            payload = json.loads(request.content)
            assert payload['repository']['id'] == 7
            assert b'installation-secret' not in request.content
            assert b'user-token' not in request.content
            return httpx.Response(200, json={'accepted': True})
        if path == '/installation/repositories':
            assert request.headers['authorization'] == 'Bearer installation-secret'
        return httpx.Response(200, json={'repositories': [repo()]})
    app = create_app(settings, httpx.MockTransport(handler))
    with TestClient(app) as client:
        login_session(app, client)
        assert client.get('/github/repositories').json()['repositories'][0]['id'] == 7
        response = client.post('/audits', json={'website_url': 'https://example.com',
            'installation_id': 3, 'repository_id': 7}, headers={
                'Origin': settings.frontend_origin, 'X-CSRF-Token': 'csrf'})
        assert response.status_code == 202
        assert set(response.json()) == {'job_id', 'status'}
        assert '/webhook/test' in calls


@pytest.mark.parametrize('status,expected', [(401, 401), (403, 403), (500, 502)])
def test_github_failures(settings, status, expected):
    app = create_app(settings, httpx.MockTransport(lambda r: httpx.Response(status, json={'message': 'secret detail'})))
    with TestClient(app) as client:
        login_session(app, client)
        response = client.get('/github/repositories')
        assert response.status_code == expected
        assert 'secret detail' not in response.text


def test_oauth_failure(settings):
    app = create_app(settings, httpx.MockTransport(lambda r: httpx.Response(200, json={'error': 'bad_verification_code'})))
    with TestClient(app) as client:
        response = client.get('/auth/github/login', follow_redirects=False)
        state = parse_qs(urlsplit(response.headers['location']).query)['state'][0]
        assert client.get(f'/auth/github/callback?state={state}&code=bad').status_code == 401


def test_unauthenticated_and_expired_session(settings):
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get('/health').json() == {'status': 'ok'}
        for endpoint in ['/health/github', '/auth/github/me', '/github/install', '/github/repositories']:
            assert client.get(endpoint).status_code == 401
        assert client.post('/audits', json={}).status_code == 401
        login_session(app, client)
        app.state.sessions.items['test-session']['expires'] = time.time() - 1
        assert client.get('/auth/github/me').status_code == 401


def test_private_url_rejected():
    import asyncio
    from fastapi import HTTPException
    from backend.main import validate_website
    for url in ['http://127.0.0.1', 'http://169.254.169.254', 'file:///etc/passwd',
                'https://user:password@example.com', 'http://[::1]', 'https://example.com:8080']:
        with pytest.raises(HTTPException):
            asyncio.run(validate_website(url))


def test_pagination(settings):
    def handler(request):
        if request.url.path == '/user/installations':
            return httpx.Response(200, json={'installations': [{'id': 3, 'app_id': 42}]})
        page = request.url.params['page']
        return httpx.Response(200, json={'repositories': [dict(repo(), id=i) for i in range(100)]
                                       if page == '1' else [dict(repo(), id=100)]})
    app = create_app(settings, httpx.MockTransport(handler))
    with TestClient(app) as client:
        login_session(app, client)
        assert len(client.get('/github/repositories').json()['repositories']) == 101


@pytest.mark.parametrize('failure', ['token_expired', 'installation_removed', 'n8n_failed', 'n8n_timeout'])
def test_audit_upstream_failures(settings, monkeypatch, failure):
    async def public(url):
        pass
    monkeypatch.setattr('backend.main.validate_website', public)
    def handler(request):
        path = request.url.path
        if path == '/user/installations':
            return httpx.Response(200, json={'installations': [{'id': 3, 'app_id': 42}]})
        if path.endswith('/access_tokens'):
            return httpx.Response(401 if failure == 'token_expired' else 201, json={'token': 'secret'})
        if path == '/installation/repositories' and failure == 'installation_removed':
            return httpx.Response(200, json={'repositories': []})
        if path == '/webhook/test':
            if failure == 'n8n_timeout':
                raise httpx.ReadTimeout('timeout', request=request)
            return httpx.Response(500)
        return httpx.Response(200, json={'repositories': [repo()]})
    app = create_app(settings, httpx.MockTransport(handler))
    with TestClient(app) as client:
        login_session(app, client)
        response = client.post('/audits', json={'website_url': 'https://example.com',
            'installation_id': 3, 'repository_id': 7}, headers={
                'Origin': settings.frontend_origin, 'X-CSRF-Token': 'csrf'})
        assert response.status_code == {'token_expired': 401, 'installation_removed': 403}.get(failure, 502)
