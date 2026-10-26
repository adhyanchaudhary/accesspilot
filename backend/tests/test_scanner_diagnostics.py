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
    ('report_emit', 'report_emit_failed')])
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
            proxy_url='http://127.0.0.1:12345', diagnostic_path=str(diagnostic))
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
    monkeypatch.setattr(diagnostics, 'memory_snapshot', lambda: {'limit_bytes': 536870912, 'oom_kills': 0})
    monkeypatch.setattr(scanner_platform, 'is_windows', lambda: True)
    monkeypatch.setenv('SystemRoot', str(tmp_path / 'Windows'))
    monkeypatch.setattr(scanner_platform, 'open_windows_report', lambda path: __import__('os').open(path, __import__('os').O_RDONLY))
    class Process:
        closed = False
        async def wait(self):
            return 1
        async def read_stdout(self, limit):
            return b'', False
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
    assert 'memory_before' in caplog.text and '536870912' in caplog.text
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


def test_memory_snapshot_reads_only_numeric_counters(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'linux')
    (tmp_path / 'memory.current').write_text('123456\n')
    (tmp_path / 'memory.max').write_text('536870912\n')
    (tmp_path / 'memory.peak').write_text('500000000\n')
    (tmp_path / 'memory.events').write_text('low 0\noom 3\noom_kill 2\nsecret 99\n')
    assert diagnostics.memory_snapshot(tmp_path) == {
        'current_bytes': 123456, 'limit_bytes': 536870912,
        'peak_bytes': 500000000, 'oom_events': 3, 'oom_kills': 2}


def test_unavailable_memory_is_unknown_not_zero(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'linux')
    assert diagnostics.memory_snapshot(tmp_path) == {}
    (tmp_path / 'memory.max').write_text('max')
    (tmp_path / 'memory.current').write_text(SECRET)
    assert diagnostics.memory_snapshot(tmp_path) == {}
    monkeypatch.setattr(sys, 'platform', 'win32')
    assert diagnostics.memory_snapshot(tmp_path) == {}


def test_v1_memory_counters_and_unlimited_sentinel(tmp_path, monkeypatch):
    monkeypatch.setattr(sys, 'platform', 'linux')
    directory = tmp_path / 'memory'
    directory.mkdir()
    (directory / 'memory.usage_in_bytes').write_text('100')
    (directory / 'memory.limit_in_bytes').write_text(str(2**63 - 4096))
    (directory / 'memory.failcnt').write_text('3')
    assert diagnostics.memory_snapshot(tmp_path) == {'current_bytes': 100, 'limit_hits': 3}


def test_memory_and_event_fields_cannot_smuggle_strings(caplog):
    diagnostics.log({'stage': 'axe', 'reason': 'axe_failed',
        'memory_before': {'current_bytes': SECRET, SECRET: 10, 'limit_bytes': True},
        'memory_after': {'oom_kills': 1, 'peak_bytes': -1},
        'page_crashed': True, 'browser_disconnected': SECRET})
    assert SECRET not in caplog.text
    assert '"oom_kills": 1' in caplog.text
    assert '"page_crashed": true' in caplog.text


@pytest.mark.parametrize('crash_event', [None, 'crash', 'close', 'disconnected'])
def test_browser_events_ignore_intentional_cleanup(tmp_path, monkeypatch, crash_event):
    context, browser, playwright, manager, axe, page = (MagicMock() for _ in range(6))
    manager.__enter__.return_value = playwright
    playwright.chromium.launch.return_value = browser
    browser.new_context.return_value = context
    context.new_page.return_value = page
    callbacks = {}
    browser.on.side_effect = lambda name, callback: callbacks.update({name: callback})
    page.on.side_effect = lambda name, callback: callbacks.update({name: callback})
    browser.close.side_effect = lambda: callbacks['disconnected'](browser)

    def fail(_page):
        if crash_event:
            callbacks[crash_event]()
        raise RuntimeError(SECRET)

    axe.run.side_effect = fail
    monkeypatch.setattr(scanner, 'sync_playwright', lambda: manager)
    monkeypatch.setattr(scanner, 'Axe', lambda: axe)
    path = tmp_path / 'diagnostic.json'
    with pytest.raises(SystemExit):
        scanner.run_robust_scan('https://example.com', proxy_url='http://127.0.0.1:12345',
                               diagnostic_path=str(path))
    result = json.loads(path.read_text())
    for event, field in [('crash', 'page_crashed'), ('close', 'page_closed'),
                         ('disconnected', 'browser_disconnected')]:
        assert result[field] is (crash_event == event)
    assert SECRET not in path.read_text()
