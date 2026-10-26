import pytest
from fastapi.testclient import TestClient

from backend import serve
from backend.github_auth import Settings
from backend.run import server_options as local_options


def test_container_binding_preserves_hardened_options(monkeypatch):
    monkeypatch.setenv('PORT', '10000')
    options = serve.server_options()
    assert options['host'] == '0.0.0.0'
    assert options['port'] == 10000
    assert options['workers'] == 1
    assert options['access_log'] is False
    assert options['proxy_headers'] is False
    assert options['limit_concurrency'] == 32
    assert local_options()['host'] == '127.0.0.1'


@pytest.mark.parametrize('value', ['', '0', '65536', '-1', 'abc', '8000\n', '８０００'])
def test_invalid_container_port_fails_closed(monkeypatch, value):
    monkeypatch.setenv('PORT', value)
    with pytest.raises(ValueError, match='PORT'):
        serve.server_options()


def test_public_launcher_forces_secure_cookies_and_disables_docs(monkeypatch):
    settings = Settings()
    monkeypatch.setattr(Settings, 'from_env', lambda: settings)
    observed = {}

    def run(app, **options):
        observed.update(options)
        assert app.debug is False
        assert not {'/docs', '/redoc', '/openapi.json'} & {r.path for r in app.routes}

    monkeypatch.setattr(serve.uvicorn, 'run', run)
    serve.main()
    assert settings.cookie_secure is True
    assert settings.tunnel_mode is True
    assert observed['workers'] == 1
    assert observed['log_level'] == 'info'
    assert observed['access_log'] is False
    assert observed['proxy_headers'] is False


def test_render_health_accepts_only_assigned_host(monkeypatch):
    from backend.main import create_app

    monkeypatch.setenv('RENDER_EXTERNAL_HOSTNAME', 'accesspilot-test.onrender.com')
    settings = Settings.from_env()
    settings.tunnel_mode = True
    settings.mongo_uri = ''
    app = create_app(settings)
    with TestClient(app, base_url='https://accesspilot-test.onrender.com') as client:
        response = client.get('/health')
        assert response.status_code == 200
        assert response.json() == {'status': 'ok'}
        assert response.headers['cache-control'] == 'no-store'
        assert client.get('/docs').status_code == 404
        for host in ('another-service.onrender.com', 'evil.example'):
            assert client.get('/health', headers={'Host': host}).status_code == 400
        assert client.get('/health', headers={
            'Host': 'evil.example', 'X-Forwarded-Host': settings.render_external_hostname
        }).status_code == 400


@pytest.mark.parametrize('host', ['*', '*.onrender.com', 'https://app.onrender.com',
    'app.onrender.com/path', 'app.onrender.com:10000', 'app.onrender.com.evil.example'])
def test_invalid_render_host_fails_closed(host):
    with pytest.raises(ValueError, match='RENDER_EXTERNAL_HOSTNAME'):
        Settings(render_external_hostname=host)


def test_tunnel_does_not_implicitly_allow_render_hosts():
    from backend.main import create_app

    app = create_app(Settings(tunnel_mode=True))
    with TestClient(app, base_url='https://unconfigured.onrender.com') as client:
        assert client.get('/health').status_code == 400
