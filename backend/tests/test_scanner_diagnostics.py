import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend import scanner
from backend import scanner_diagnostics as diagnostics
from backend.audit_scans import ScannerRunner, ScanFailure

SECRET = 'TOKEN-THAT-MUST-NOT-BE-LOGGED'


@pytest.mark.parametrize('stage,reason', [
    ('dependencies', 'dependency_missing'), ('driver_start', 'driver_start_failed'),
    ('browser_launch', 'browser_missing'), ('context_setup', 'context_setup_failed'),
    ('navigation', 'proxy_connection_failed'), ('axe', 'axe_failed'),
    ('report_write', 'report_write_failed')])
def test_stage_failures_preserve_safe_diagnostic_without_raw_details(tmp_path, axe_report, monkeypatch, caplog, stage, reason):
    context, browser, playwright, manager, axe = (MagicMock() for _ in range(5))
    manager.__enter__.return_value = playwright
    playwright.chromium.launch.return_value = browser
    browser.new_context.return_value = context
    axe.run.return_value = SimpleNamespace(response=axe_report)
    monkeypatch.setattr(scanner, 'sync_playwright', lambda: manager)
    monkeypatch.setattr(scanner, 'Axe', lambda: axe)
    failure = RuntimeError(f'https://example.com/?code={SECRET} private_key={SECRET}')
    if stage == 'dependencies':
        def fail():
            raise ModuleNotFoundError(SECRET)
        monkeypatch.setattr(scanner, 'load_dependencies', fail)
    elif stage == 'driver_start':
        manager.__enter__.side_effect = failure
    elif stage == 'browser_launch':
        playwright.chromium.launch.side_effect = RuntimeError("Executable doesn't exist at C:/" + SECRET)
    elif stage == 'context_setup':
        browser.new_context.side_effect = failure
    elif stage == 'navigation':
        context.new_page.return_value.goto.side_effect = RuntimeError('net::ERR_PROXY_CONNECTION_FAILED ' + SECRET)
        browser.close.side_effect = RuntimeError('secondary close error ' + SECRET)
    elif stage == 'axe':
        axe.run.side_effect = failure
    else:
        monkeypatch.setattr(scanner, 'MAX_CHILD_FILE_BYTES', 1)
    diagnostic = tmp_path / 'diagnostic.json'
    with pytest.raises(SystemExit) as error:
        scanner.run_robust_scan('https://example.com/?token='+SECRET,
            output_filename=str(tmp_path / 'audit.json'), proxy_url='http://127.0.0.1:12345',
            diagnostic_path=str(diagnostic))
    assert error.value.code == 1
    result = json.loads(diagnostic.read_text())
    assert result['stage'] == stage and result['reason'] == reason
    assert SECRET not in diagnostic.read_text() + caplog.text
    assert 'https://' not in diagnostic.read_text()
    if stage != 'dependencies' and stage != 'driver_start':
        args = playwright.chromium.launch.call_args.kwargs
        assert '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1' in args['args']
        assert args['proxy']['bypass'] == '<-loopback>' and args['chromium_sandbox'] is True


def test_classifier_extracts_safe_browser_status_and_never_exception_message(caplog):
    error = RuntimeError('launch failed ' + SECRET + ' exitCode=3221225781, signal=null')
    diagnostics.log(diagnostics.record('browser_launch', diagnostics.classify('browser_launch', error), error))
    assert SECRET not in caplog.text
    assert '3221225781' in caplog.text
    assert 'browser_launch_failed' in caplog.text


def test_untrusted_diagnostics_cannot_add_secrets_or_paths(caplog):
    data = {'stage': 'navigation', 'reason': 'navigation_failed', 'platform': 'win32',
        'exception': SECRET, 'url': 'https://example.com/?token='+SECRET, 'traceback': SECRET,
        'python': SECRET, 'playwright': SECRET, 'winerror': SECRET, 'private_key': SECRET,
        'proxy_failures': {'policy_denied': 2, SECRET: 10}}
    diagnostics.log(data)
    assert SECRET not in caplog.text
    assert 'policy_denied' in caplog.text
    assert diagnostics.validate({'stage': [], 'reason': {}}) is None


def test_child_dependency_failure_is_logged_by_parent_without_publishing_details(tmp_path, monkeypatch, caplog):
    from backend import scanner_platform
    # Exercise the actual runner's parent-side handling; platform process creation is mocked.
    class Proxy:
        url = 'http://127.0.0.1:12345'
        failures = {'policy_denied': 1}
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr('backend.audit_scans.PublicScanProxy', Proxy)
    monkeypatch.setattr(scanner_platform, 'is_windows', lambda: True)
    monkeypatch.setenv('SystemRoot', str(tmp_path / 'Windows'))
    monkeypatch.setattr(scanner_platform, 'open_windows_report', lambda path: __import__('os').open(path, __import__('os').O_RDONLY))
    class Process:
        closed = False
        async def wait(self):
            return 1
        async def close(self):
            self.closed = True
    process = Process()
    async def spawn(args, work, env):
        path = Path(args[args.index('--diagnostic') + 1])
        path.write_text(json.dumps({'stage': 'dependencies', 'reason': 'dependency_missing',
                                   'exception': 'ModuleNotFoundError', 'message': SECRET}))
        return process
    monkeypatch.setattr(scanner_platform, 'spawn_windows', spawn)
    async def run():
        with pytest.raises(ScanFailure) as error:
            await ScannerRunner()('https://example.com/?token='+SECRET)
        assert error.value.code == 'scanner_dependency_missing'
    asyncio.run(run())
    assert process.closed
    assert 'dependencies' in caplog.text and 'policy_denied' in caplog.text
    assert SECRET not in caplog.text


@pytest.mark.parametrize('winerror', [32, 33, 145])
def test_windows_cleanup_handles_share_locks_and_nonempty_directory(monkeypatch, winerror):
    from backend import scanner_platform
    monkeypatch.setattr(scanner_platform, 'is_windows', lambda: True)
    error = OSError('private path '+SECRET)
    error.winerror = winerror
    temporary = MagicMock()
    temporary.cleanup.side_effect = [error, None]
    asyncio.run(scanner_platform.cleanup_workspace(temporary))
    assert temporary.cleanup.call_count == 2
