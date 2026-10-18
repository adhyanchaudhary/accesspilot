"""Safe local launcher; does not create or start a tunnel."""
import argparse

import uvicorn


def server_options():
    return dict(host='127.0.0.1', port=8000, access_log=False, proxy_headers=False,
                server_header=False, log_level='warning', limit_concurrency=32,
                timeout_keep_alive=5, h11_max_incomplete_event_size=16384)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tunnel', action='store_true', help='Disable public API documentation')
    args = parser.parse_args()
    from .github_auth import Settings
    from .main import create_app
    settings = Settings.from_env()
    settings.tunnel_mode = args.tunnel or settings.tunnel_mode
    uvicorn.run(create_app(settings), **server_options())


if __name__ == '__main__':
    main()
