"""Platform-specific scanner containment; no GitHub or webhook configuration."""
import asyncio
import ctypes
import os
import stat
import subprocess
import site
import sys
from pathlib import Path

MAX_CHILD_FILE_BYTES = 4 * 1024 * 1024
MAX_WORKSPACE_BYTES = 64 * 1024 * 1024
CHILD_CPU_SECONDS = 60
CONTAINMENT_EXIT = 72
TIMEOUT_EXIT = 124
_WINDOWS_JOB = None  # Owned by this process; OS closes it at exit, killing descendants.


def is_windows():
    return sys.platform == 'win32'


class PlatformError(Exception):
    pass


class BasicLimitInformation(ctypes.Structure):
    _fields_ = [('PerProcessUserTimeLimit', ctypes.c_int64), ('PerJobUserTimeLimit', ctypes.c_int64),
                ('LimitFlags', ctypes.c_uint32), ('MinimumWorkingSetSize', ctypes.c_size_t),
                ('MaximumWorkingSetSize', ctypes.c_size_t), ('ActiveProcessLimit', ctypes.c_uint32),
                ('Affinity', ctypes.c_size_t), ('PriorityClass', ctypes.c_uint32),
                ('SchedulingClass', ctypes.c_uint32)]


class IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in ('ReadOperationCount', 'WriteOperationCount',
        'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]


class ExtendedLimitInformation(ctypes.Structure):
    _fields_ = [('BasicLimitInformation', BasicLimitInformation), ('IoInfo', IoCounters),
                ('ProcessMemoryLimit', ctypes.c_size_t), ('JobMemoryLimit', ctypes.c_size_t),
                ('PeakProcessMemoryUsed', ctypes.c_size_t), ('PeakJobMemoryUsed', ctypes.c_size_t)]


class AttributeTagInformation(ctypes.Structure):
    _fields_ = [('FileAttributes', ctypes.c_uint32), ('ReparseTag', ctypes.c_uint32)]


def kernel32():
    # Imported only on Windows; mocking this boundary permits platform-independent tests.
    api = ctypes.WinDLL('kernel32', use_last_error=True)
    signatures = {
        'CreateJobObjectW': ([ctypes.c_void_p, ctypes.c_wchar_p], ctypes.c_void_p),
        'SetInformationJobObject': ([ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32], ctypes.c_int),
        'AssignProcessToJobObject': ([ctypes.c_void_p, ctypes.c_void_p], ctypes.c_int),
        'GetCurrentProcess': ([], ctypes.c_void_p),
        'CloseHandle': ([ctypes.c_void_p], ctypes.c_int),
        'CreateFileW': ([ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p,
                         ctypes.c_uint32, ctypes.c_uint32, ctypes.c_void_p], ctypes.c_void_p),
        'GetFileInformationByHandleEx': ([ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32], ctypes.c_int),
        'GetFileType': ([ctypes.c_void_p], ctypes.c_uint32),
    }
    for name, (args, result) in signatures.items():
        getattr(api, name).argtypes = args
        getattr(api, name).restype = result
    return api


def install_windows_job():
    """Called in the child BEFORE Playwright can launch any descendants.

    A non-inheritable job handle lives only in the scanner. Its death/exit closes
    that handle and the kernel terminates all job members, including Chromium.
    Windows 11 supports nested jobs; failure to establish containment fails closed.
    """
    global _WINDOWS_JOB
    api = kernel32()
    handle = api.CreateJobObjectW(None, None)
    if not handle:
        raise PlatformError('scanner_containment_failed')
    info = ExtendedLimitInformation()
    info.BasicLimitInformation.LimitFlags = 0x2000 | 0x4  # KILL_ON_JOB_CLOSE | JOB_TIME
    info.BasicLimitInformation.PerJobUserTimeLimit = CHILD_CPU_SECONDS * 10_000_000
    if not api.SetInformationJobObject(handle, 9, ctypes.byref(info), ctypes.sizeof(info)):
        api.CloseHandle(handle)
        raise PlatformError('scanner_containment_failed')
    if not api.AssignProcessToJobObject(handle, api.GetCurrentProcess()):
        api.CloseHandle(handle)
        raise PlatformError('scanner_containment_failed')
    # Do not CloseHandle here: the scanner itself is a member of the kill-on-close job.
    _WINDOWS_JOB = handle


def install_child_limits():
    if is_windows():
        install_windows_job()
    else:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (CHILD_CPU_SECONDS, CHILD_CPU_SECONDS))
        resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_CHILD_FILE_BYTES, MAX_CHILD_FILE_BYTES))
    # Independent wall-time bound, including if the parent disappears during spawn.
    import threading
    timer = threading.Timer(CHILD_CPU_SECONDS, lambda: os._exit(TIMEOUT_EXIT))
    timer.daemon = True
    timer.start()


def scanner_environment(work):
    env = {'PATH': os.defpath, 'HOME': work, 'TMPDIR': work, 'XDG_CACHE_HOME': work,
           'PYTHONUTF8': '1', 'LANG': 'C.UTF-8'}
    # HOME/APPDATA isolation otherwise changes Python's user-site directory, even
    # with the same sys.executable. Preserve installed packages, not browser profiles
    # or arbitrary inherited PYTHONPATH/PYTHONHOME settings.
    if site.ENABLE_USER_SITE:
        env['PYTHONUSERBASE'] = site.getuserbase()
    else:
        env['PYTHONNOUSERSITE'] = '1'
    browser_path = os.getenv('PLAYWRIGHT_BROWSERS_PATH')
    if is_windows():
        root = os.getenv('SystemRoot') or os.getenv('SYSTEMROOT')
        if not root:
            raise PlatformError('scanner_environment_invalid')
        local = os.getenv('LOCALAPPDATA') or str(Path.home() / 'AppData' / 'Local')
        browser_path = browser_path or str(Path(local) / 'ms-playwright')
        env.update(SystemRoot=root, WINDIR=root, TEMP=work, TMP=work,
                   USERPROFILE=work, APPDATA=work, LOCALAPPDATA=work,
                   PATH=os.pathsep.join((str(Path(sys.executable).parent), str(Path(root) / 'System32'))))
    elif sys.platform == 'darwin':
        browser_path = browser_path or str(Path.home() / 'Library' / 'Caches' / 'ms-playwright')
    else:
        browser_path = browser_path or str(Path.home() / '.cache' / 'ms-playwright')
    env['PLAYWRIGHT_BROWSERS_PATH'] = ('0' if browser_path == '0'
        else str(Path(browser_path).expanduser().resolve()))
    return env


def check_windows_workspace(work):
    """Windows has no RLIMIT_FSIZE. Bound audit writes and monitor browser temp files."""
    total = entries = 0
    pending = [work]
    while pending:
        try:
            children = os.scandir(pending.pop())
        except FileNotFoundError:
            continue
        with children:
            for entry in children:
                entries += 1
                if entries > 4096:
                    raise PlatformError('scan_resource_limit')
                try:
                    info = entry.stat(follow_symlinks=False)
                except FileNotFoundError:
                    continue  # Chromium can remove cache entries while they are inspected.
                if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
                    raise PlatformError('scan_resource_limit')
                if stat.S_ISDIR(info.st_mode):
                    pending.append(entry.path)
                else:
                    total += info.st_size
                    if info.st_size > MAX_CHILD_FILE_BYTES or total > MAX_WORKSPACE_BYTES:
                        raise PlatformError('scan_resource_limit')


class WindowsProcess:
    """Popen avoids SelectorEventLoop's unsupported asyncio subprocess operations."""
    def __init__(self, process, work):
        self.process, self.work = process, work

    async def wait(self):
        while self.process.poll() is None:
            await asyncio.to_thread(check_windows_workspace, self.work)
            await asyncio.sleep(.1)
        return self.process.returncode

    async def read_stdout(self, limit):
        return await asyncio.to_thread(self._read_stdout, limit)

    def _read_stdout(self, limit):
        stream = self.process.stdout
        if stream is None:
            return b'', False
        chunks, retained, overflow = [], 0, False
        while True:
            chunk = stream.read(65536)
            if not chunk:
                break
            if retained < limit + 1:
                keep = chunk[:limit + 1 - retained]
                chunks.append(keep)
                retained += len(keep)
                overflow = overflow or retained > limit
        return b''.join(chunks), overflow

    async def close(self):
        if self.process.poll() is None:
            self.process.kill()  # Closing the child's job handle kills all descendants.
        try:
            await asyncio.to_thread(self.process.wait, timeout=5)
        except subprocess.TimeoutExpired:
            raise PlatformError('scanner_cleanup_failed') from None
        if self.process.stdout is not None:
            try:
                self.process.stdout.close()
            except OSError:
                pass


async def spawn_windows(args, work, env):
    # Shield spawn so cancellation cannot orphan the Popen result in an executor thread.
    launch = asyncio.create_task(asyncio.to_thread(subprocess.Popen, args,
        cwd=work, env=env, creationflags=0x200 | 0x08000000,  # NEW_PROCESS_GROUP | NO_WINDOW
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        close_fds=True, shell=False))
    try:
        process = await asyncio.shield(launch)
    except asyncio.CancelledError:
        process = await launch
        await WindowsProcess(process, work).close()
        raise
    return WindowsProcess(process, work)


def open_windows_report(path):
    """Open without following reparse points; hold a handle denying write/delete."""
    import msvcrt
    api = kernel32()
    # GENERIC_READ, FILE_SHARE_READ only, OPEN_EXISTING, OPEN_REPARSE_POINT | SEQUENTIAL_SCAN
    handle = api.CreateFileW(str(path), 0x80000000, 1, None, 3, 0x00200000 | 0x08000000, None)
    if handle in (None, ctypes.c_void_p(-1).value):
        raise OSError('Cannot open scanner report')
    try:
        info = AttributeTagInformation()
        if (not api.GetFileInformationByHandleEx(handle, 9, ctypes.byref(info), ctypes.sizeof(info))
                or info.FileAttributes & (0x400 | 0x10) or api.GetFileType(handle) != 1):
            raise OSError('Scanner report is not a regular non-reparse file')
        fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
    except BaseException:
        api.CloseHandle(handle)
        raise
    return fd  # ownership transferred to the CRT; fdopen/close now closes the Windows handle


def open_report(path):
    if is_windows():
        fd = open_windows_report(path)
    else:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    return os.fdopen(fd, 'rb')


async def cleanup_workspace(temporary):
    if not is_windows():
        temporary.cleanup()
        return
    # Windows can retain browser/profile handles briefly after Job Object teardown.
    for attempt in range(50):
        try:
            await asyncio.to_thread(temporary.cleanup)
            return
        except OSError as error:
            if not isinstance(error, PermissionError) and getattr(error, 'winerror', None) not in (5, 32, 33, 145):
                raise PlatformError('scanner_cleanup_failed') from None
            if attempt == 49:
                raise PlatformError('scanner_cleanup_failed') from None
            await asyncio.sleep(.1)
