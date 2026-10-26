"""Guarded Playwright/axe child. Structured, allowlisted diagnostics only."""
import argparse
import json
import sys
from urllib.parse import urlsplit

if __package__:
    from . import scanner_diagnostics as diagnostics
    from .scanner_platform import install_child_limits, PlatformError, CONTAINMENT_EXIT, MAX_CHILD_FILE_BYTES
else:
    import scanner_diagnostics as diagnostics
    from scanner_platform import install_child_limits, PlatformError, CONTAINMENT_EXIT, MAX_CHILD_FILE_BYTES

# Lazy imports let missing/mismatched dependencies produce safe diagnostics rather than a lost traceback.
sync_playwright = Axe = None
PlaywrightTimeoutError = TimeoutError


def load_dependencies():
    global sync_playwright, Axe, PlaywrightTimeoutError
    if sync_playwright is None or Axe is None:
        from playwright.sync_api import sync_playwright as factory, TimeoutError as timeout
        from axe_playwright_python.sync_playwright import Axe as axe
        sync_playwright, Axe, PlaywrightTimeoutError = factory, axe, timeout


def run_robust_scan(target_url, proxy_url=None, diagnostic_path=None):
    if not proxy_url:
        raise ValueError('A guarded scan proxy is required')
    # Keep the proxy exclusion narrow: direct destination DNS remains denied, and all
    # HTTP traffic (including localhost) must still traverse the public-only proxy.
    parsed_proxy = urlsplit(proxy_url)
    if parsed_proxy.scheme != 'http' or parsed_proxy.hostname != '127.0.0.1' or not parsed_proxy.port:
        raise ValueError('The scan proxy must be a loopback IPv4 listener')
    stage = 'dependencies'
    browser = None
    closing = False
    events = {'page_crashed': False, 'page_closed': False, 'browser_disconnected': False}

    def event(name):
        if not closing:
            events[name] = True
            data = diagnostics.record(stage, 'running')
            data.update(events)
            diagnostics.write(diagnostic_path, data)

    def progress(next_stage):
        nonlocal stage
        stage = next_stage
        diagnostics.write(diagnostic_path, diagnostics.record(stage, 'running'))

    try:
        progress('dependencies')
        load_dependencies()
        axe = Axe()
        progress('driver_start')
        with sync_playwright() as playwright:
            try:
                progress('browser_launch')
                browser = playwright.chromium.launch(headless=True, chromium_sandbox=True,
                    proxy={'server': proxy_url, 'bypass': '<-loopback>'},
                    args=['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
                          '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'])
                browser.on('disconnected', lambda *_: event('browser_disconnected'))
                progress('context_setup')
                context = browser.new_context(service_workers='block', accept_downloads=False)

                def guard(route):
                    if (route.request.method not in ('GET', 'HEAD')
                            or urlsplit(route.request.url).scheme not in ('http', 'https')):
                        return route.abort()
                    return route.continue_()

                context.route('**/*', guard)
                context.route_web_socket('**/*', lambda ws: ws.close())
                page = context.new_page()
                page.on('crash', lambda *_: event('page_crashed'))
                page.on('close', lambda *_: event('page_closed'))
                progress('navigation')
                page.goto(target_url, timeout=30000, wait_until='domcontentloaded')
                progress('axe')
                results = axe.run(page)
                if not hasattr(results, 'response') or not isinstance(results.response, dict):
                    raise ValueError('Invalid axe result structure')
            finally:
                closing = True  # Intentional cleanup must not count as a crash/disconnect.
                if browser:
                    # Do not let a secondary close error hide the primary failure stage.
                    try:
                        browser.close()
                    except Exception:
                        pass  # Parent Job Object/process group teardown remains mandatory.
        progress('report_emit')
        payload = json.dumps(results.response, allow_nan=False, separators=(',', ':')).encode('utf-8')
        if len(payload) > MAX_CHILD_FILE_BYTES:
            raise ValueError('Scanner report exceeds the output limit')
        # The parent consumes this stream with a hard byte cap; no report file is created.
        sys.stdout.buffer.write(payload)
        sys.stdout.buffer.flush()
        diagnostics.write(diagnostic_path, diagnostics.record('complete', 'ok'))
    except Exception as error:
        data = diagnostics.record(stage, diagnostics.classify(stage, error), error)
        data.update(events)
        diagnostics.write(diagnostic_path, data)
        if not diagnostic_path:
            diagnostics.log(data)
        raise SystemExit(1) from None


def main():
    parser = argparse.ArgumentParser(description='Guarded axe-core accessibility scanner')
    parser.add_argument('--url', required=True)
    parser.add_argument('--owner', default='')
    parser.add_argument('--repo', default='')
    parser.add_argument('--file', default='')
    parser.add_argument('--proxy', required=True)
    parser.add_argument('--diagnostic')
    args = parser.parse_args()
    diagnostics.write(args.diagnostic, diagnostics.record('bootstrap', 'running'))
    try:
        install_child_limits()
    except (PlatformError, OSError, ValueError) as error:
        diagnostics.write(args.diagnostic, diagnostics.record('bootstrap', 'containment_failed', error))
        return CONTAINMENT_EXIT
    run_robust_scan(args.url, proxy_url=args.proxy, diagnostic_path=args.diagnostic)
    return 0


if __name__ == '__main__':
    sys.exit(main())
