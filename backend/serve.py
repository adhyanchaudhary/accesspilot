"""Single-worker container entry point; local backend.run remains unchanged."""
import os

import uvicorn

from .run import server_options as local_server_options


def server_options():
    raw_port = os.environ.get('PORT', '8000')
    if not raw_port.isascii() or not raw_port.isdecimal() or not 1 <= int(raw_port) <= 65535:
        raise ValueError('PORT must be an integer between 1 and 65535')
    return {**local_server_options(), 'host': '0.0.0.0', 'port': int(raw_port), 'workers': 1}


def main():
    from .github_auth import Settings
    from .main import create_app

    settings = Settings.from_env()
    settings.tunnel_mode = True  # Public container always disables API documentation.
    settings.cookie_secure = True
    uvicorn.run(create_app(settings), **server_options())


if __name__ == '__main__':
    main()
