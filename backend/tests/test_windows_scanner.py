"""Windows branches mocked on all hosts, plus native containment test on Windows."""
import asyncio
import ctypes
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend import scanner_platform as platform
from backend.audit_scans import ScannerRunner, ScanFailure


@pytest.fixture
def windows(monkeypatch, tmp_path):
    monkeypatch.setattr(platform, 'is_windows', lambda: True)
    monkeypatch.setenv('SystemRoot', str(tmp_path / 'Windows'))
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path / 'User' / 'AppData' / 'Local'))
    monkeypatch.delenv('PLAYWRIGHT_BROWSERS_PATH', raising=False)
    return tmp_path


def test_windows_environment_uses_installed_browser_cache_without_secrets(windows, monkeypatch):
    monkeypatch.setenv('GITHUB_PRIVATE_KEY', 'secret')
    monkeypatch.setenv('N8N_WEBHOOK_SECRET', 'secret')
    env = platform.scanner_environment(str(windows / 'work'))
    assert Path(env['PLAYWRIGHT_BROWSERS_PATH']) == windows / 'User' / 'AppData' / 'Local' / 'ms-playwright'
    assert env['SystemRoot'] == str(windows / 'Windows')
    for key in ('TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'):
        assert env[key] == str(windows / 'work')
    assert 'GITHUB_PRIVATE_KEY' not in env and 'N8N_WEBHOOK_SECRET' not in env
    monkeypatch.setenv('PLAYWRIGHT_BROWSERS_PATH', str(windows / 'custom-browser'))
    assert platform.scanner_environment(str(windows))['PLAYWRIGHT_BROWSERS_PATH'] == str(windows / 'custom-browser')
    monkeypatch.setenv('PLAYWRIGHT_BROWSERS_PATH', '0')
    assert platform.scanner_environment(str(windows))['PLAYWRIGHT_BROWSERS_PATH'] == '0'


@pytest.mark.parametrize('failure', [None, 'create', 'limits', 'assign'])
def test_windows_job_contains_children_and_enforces_cpu_limit(monkeypatch, failure):
    api = MagicMock()
    api.CreateJobObjectW.return_value = 42 if failure != 'create' else 0
    api.AssignProcessToJobObject.return_value = failure != 'assign'
    api.GetCurrentProcess.return_value = -1
    captured = []
    def set_limits(handle, kind, pointer, size):
        info = ctypes.cast(pointer, ctypes.POINTER(platform.ExtendedLimitInformation)).contents
        captured.append((info.BasicLimitInformation.LimitFlags, info.BasicLimitInformation.PerJobUserTimeLimit))
        assert handle == 42 and kind == 9 and size == ctypes.sizeof(platform.ExtendedLimitInformation)
        return failure != 'limits'
    api.SetInformationJobObject.side_effect = set_limits
    monkeypatch.setattr(platform, 'kernel32', lambda: api)
    if failure:
        with pytest.raises(platform.PlatformError, match='scanner_containment_failed'):
            platform.install_windows_job()
        if failure != 'create':
            api.CloseHandle.assert_called_once_with(42)
    else:
        platform.install_windows_job()
        assert captured == [(0x2004, 60 * 10_000_000)]
        api.AssignProcessToJobObject.assert_called_once_with(42, -1)
        api.CloseHandle.assert_not_called()  # handle must live until child exit


@pytest.mark.parametrize('kind', ['regular', 'reparse', 'directory', 'pipe', 'failure'])
def test_windows_report_handle_does_not_follow_links(monkeypatch, kind):
    api = MagicMock()
    api.CreateFileW.return_value = 42
    def info(handle, level, pointer, size):
        attributes = ctypes.cast(pointer, ctypes.POINTER(platform.AttributeTagInformation)).contents
        attributes.FileAttributes = {'reparse': 0x400, 'directory': 0x10}.get(kind, 0)
        return kind != 'failure'
    api.GetFileInformationByHandleEx.side_effect = info
    api.GetFileType.return_value = 3 if kind == 'pipe' else 1
    convert = MagicMock(return_value=17)
    monkeypatch.setitem(sys.modules, 'msvcrt', SimpleNamespace(open_osfhandle=convert))
    monkeypatch.setattr(os, 'O_BINARY', 0, raising=False)
    monkeypatch.setattr(platform, 'kernel32', lambda: api)
    if kind == 'regular':
        assert platform.open_windows_report(Path('audit.json')) == 17
        convert.assert_called_once()
        api.CloseHandle.assert_not_called()  # CRT now owns handle
    else:
        with pytest.raises(OSError):
            platform.open_windows_report(Path('audit.json'))
        api.CloseHandle.assert_called_once_with(42)
        convert.assert_not_called()
    args = api.CreateFileW.call_args.args
    assert args[2] == 1  # no FILE_SHARE_WRITE / FILE_SHARE_DELETE
    assert args[5] & 0x00200000  # FILE_FLAG_OPEN_REPARSE_POINT


@pytest.mark.parametrize('mode', ['success', 'nonzero', 'containment', 'timeout', 'cancel'])
def test_windows_runner_always_cleans_process_and_temp_files(windows, monkeypatch, axe_report, mode):
    captured = {}
    class Proxy:
        url = 'http://127.0.0.1:12345'
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
    monkeypatch.setattr('backend.audit_scans.PublicScanProxy', Proxy)
    monkeypatch.setattr('backend.audit_scans.SCAN_TIMEOUT', .01)
    # Native handle behavior is tested above. Use a real regular fd for parser checks.
    monkeypatch.setattr(platform, 'open_windows_report', lambda path: os.open(path, os.O_RDONLY))
    class Process:
        closed = False
        async def wait(self):
            if mode in ('timeout', 'cancel'):
                await asyncio.sleep(1)
            return {'nonzero': 1, 'containment': platform.CONTAINMENT_EXIT}.get(mode, 0)
        async def close(self):
            self.closed = True
    process = Process()
    async def spawn(args, work, env):
        captured.update(args=args, work=work, env=env)
        Path(args[args.index('--output') + 1]).write_text(json.dumps(axe_report))
        return process
    monkeypatch.setattr(platform, 'spawn_windows', spawn)
    async def forbidden(*args, **kwargs):
        raise AssertionError('asyncio subprocess APIs must not be used on Windows')
    monkeypatch.setattr('backend.audit_scans.asyncio.create_subprocess_exec', forbidden)
    async def run():
        if mode == 'success':
            assert await ScannerRunner()('https://example.com') == axe_report
        elif mode == 'cancel':
            task = asyncio.create_task(ScannerRunner()('https://example.com'))
            await asyncio.sleep(.002)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        else:
            with pytest.raises(ScanFailure) as error:
                await ScannerRunner()('https://example.com')
            assert error.value.code == {'nonzero': 'scanner_failed', 'containment': 'scanner_containment_failed',
                'timeout': 'scan_timed_out'}[mode]
    asyncio.run(run())
    assert process.closed and not Path(captured['work']).exists()
    assert '--proxy' in captured['args']
    assert captured['env']['SystemRoot'] == str(windows / 'Windows')


def test_windows_spawn_supports_selector_event_loop_and_kills_on_cancellation(windows, monkeypatch):
    import threading
    started, release = threading.Event(), threading.Event()
    process = MagicMock()
    process.poll.return_value = None
    def launch(args, **kwargs):
        assert kwargs['creationflags'] == 0x200 | 0x08000000
        assert kwargs['shell'] is False and kwargs['close_fds'] is True
        started.set()
        release.wait(2)
        return process
    monkeypatch.setattr(platform.subprocess, 'Popen', launch)
    async def run():
        task = asyncio.create_task(platform.spawn_windows(['python', 'scanner.py'], str(windows), {}))
        assert await asyncio.to_thread(started.wait, 1)
        task.cancel()
        release.set()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(run())
    process.kill.assert_called_once()
    process.wait.assert_called_once_with(timeout=5)


def test_windows_workspace_limits(windows, monkeypatch):
    file = windows / 'cache'
    file.write_bytes(b'12345')
    monkeypatch.setattr(platform, 'MAX_CHILD_FILE_BYTES', 4)
    with pytest.raises(platform.PlatformError, match='scan_resource_limit'):
        platform.check_windows_workspace(str(windows))


def test_windows_cleanup_retries_locked_profile(windows, monkeypatch):
    temporary = MagicMock()
    temporary.cleanup.side_effect = [PermissionError(), None]
    asyncio.run(platform.cleanup_workspace(temporary))
    assert temporary.cleanup.call_count == 2


@pytest.mark.skipif(sys.platform != 'win32', reason='Requires native Windows Job Objects')
@pytest.mark.parametrize('exit_mode', ['normal', 'killed'])
def test_native_windows_job_kills_grandchild_when_scanner_exits(tmp_path, exit_mode):
    # No browser/network/app credentials. Exercise actual kernel containment and exit status.
    import time
    marker, finish = tmp_path / 'child.pid', tmp_path / 'finish'
    code = f"""
import subprocess, sys, time
from pathlib import Path
sys.path.insert(0, {str(Path(__file__).resolve().parents[2])!r})
from backend.scanner_platform import install_child_limits
install_child_limits()
p = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
marker = Path({str(marker)!r})
temporary = marker.with_suffix('.tmp')
temporary.write_text(str(p.pid))
temporary.replace(marker)
while not Path({str(finish)!r}).exists():
    time.sleep(.05)
"""
    process = subprocess.Popen([sys.executable, '-c', code],
        env=platform.scanner_environment(str(tmp_path)),
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    api.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
    api.OpenProcess.restype = ctypes.c_void_p
    api.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
    api.WaitForSingleObject.restype = ctypes.c_uint32
    api.CloseHandle.argtypes = [ctypes.c_void_p]
    handle = None
    try:
        deadline = time.monotonic() + 10
        while not marker.exists() and time.monotonic() < deadline and process.poll() is None:
            time.sleep(.05)
        assert marker.exists(), 'Native Job Object setup did not complete'
        handle = api.OpenProcess(0x00100000, False, int(marker.read_text()))  # SYNCHRONIZE
        assert handle
        if exit_mode == 'killed':
            process.kill()
        else:
            finish.write_text('done')
        process.wait(timeout=5)
        if exit_mode == 'normal':
            assert process.returncode == 0
        assert api.WaitForSingleObject(handle, 5000) == 0  # descendant exited with job owner
    finally:
        if process.poll() is None:
            process.kill()
        process.wait(timeout=5)
        if handle:
            api.CloseHandle(handle)


def test_workspace_monitor_tolerates_removed_cache_directory(windows, monkeypatch):
    monkeypatch.setattr(platform.os, 'scandir', MagicMock(side_effect=FileNotFoundError()))
    platform.check_windows_workspace(str(windows))
