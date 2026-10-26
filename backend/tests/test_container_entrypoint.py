import pytest

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
