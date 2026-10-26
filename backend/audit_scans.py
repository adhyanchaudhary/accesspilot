"""Bounded scanner subprocess and lossless axe-core report normalization."""
import asyncio
import json
import os
import signal
import sys
import tempfile
from pathlib import Path

from .scan_network import PublicScanProxy
from . import scanner_platform
from . import scanner_diagnostics as diagnostics

MAX_REPORT_BYTES = 2 * 1024 * 1024
SCAN_TIMEOUT = 60


class ScanFailure(Exception):
    def __init__(self, code):
        self.code = code


def normalize_audit(report, requested_url):
    """Keep native axe violation/node/check evidence; fail rather than invent findings."""
    try:
        encoded = json.dumps(report, allow_nan=False).encode()
        if len(encoded) > MAX_REPORT_BYTES or not isinstance(report, dict):
            raise ValueError()
        violations = report['violations']
        if not isinstance(violations, list) or len(violations) > 500:
            raise ValueError()

        def selector(value):
            return isinstance(value, str) or (isinstance(value, list) and value and all(selector(v) for v in value))

        count = 0
        for violation in violations:
            if (not isinstance(violation, dict) or not isinstance(violation.get('id'), str)
                    or not violation['id'] or not isinstance(violation.get('description'), str)
                    or violation.get('impact') not in (None, 'minor', 'moderate', 'serious', 'critical')
                    or not isinstance(violation.get('nodes'), list) or not violation['nodes']):
                raise ValueError()
            for node in violation['nodes']:
                count += 1
                if (not isinstance(node, dict) or not isinstance(node.get('html'), str)
                        or not isinstance(node.get('target'), list) or not node['target']
                        or not selector(node['target'])):
                    raise ValueError()
                for evidence in ('any', 'all', 'none'):
                    if evidence in node and (not isinstance(node[evidence], list)
                            or not all(isinstance(item, dict) for item in node[evidence])):
                        raise ValueError()
        if count > 5000:
            raise ValueError()
        normalized = json.loads(encoded)  # independent, JSON-only structure with unknown evidence intact
        normalized['schema_version'] = 1
        normalized['requested_url'] = requested_url
        normalized['summary'] = {'violation_count': len(violations), 'affected_element_count': count}
        return normalized
    except (ValueError, TypeError, KeyError, RecursionError):
        raise ScanFailure('invalid_report') from None


def child_diagnostic(path):
    try:
        with scanner_platform.open_report(path) as stream:
            raw = stream.read(4097)
        if len(raw) <= 4096:
            return diagnostics.validate(json.loads(raw))
    except (OSError, ValueError, TypeError):
        pass
    return None


async def read_report(process, limit=MAX_REPORT_BYTES):
    """Drain the child stdout while retaining at most limit+1 bytes.

    Draining matters: stopping at the cap would let a hostile child fill the pipe
    and deadlock both processes. The retained prefix is enough to reject oversize
    reports without buffering unbounded output.
    """
    if scanner_platform.is_windows():
        return await process.read_stdout(limit)
    stream = process.stdout
    if stream is None:
        return b'', False
    chunks, retained, overflow = [], 0, False
    while True:
        chunk = await stream.read(65536)
        if not chunk:
            break
        if retained < limit + 1:
            keep = chunk[:limit + 1 - retained]
            chunks.append(keep)
            retained += len(keep)
            overflow = overflow or retained > limit
    return b''.join(chunks), overflow


async def read_browser_exit(process):
    # Drain even when noisy; keep only a 64 KiB tail in memory, never on disk.
    stream = getattr(process, 'stderr', None)
    if stream is None:
        return {}
    tail = bytearray()
    while True:
        chunk = await stream.read(8192)
        if not chunk:
            break
        tail.extend(chunk)
        if len(tail) > 65536:
            del tail[:-65536]
    return diagnostics.browser_exit_fields(bytes(tail))


class ScannerRunner:
    async def __call__(self, url):
        temporary = tempfile.TemporaryDirectory(prefix='accesspilot-scan-')
        work = temporary.name
        memory_before = diagnostics.memory_snapshot()
        try:
            diagnostic_path = Path(work) / 'scanner-diagnostic.json'
            stage = 'bootstrap'
            # Strict per-platform allowlist; never copy application credentials.
            try:
                env = scanner_platform.scanner_environment(work)
            except scanner_platform.PlatformError as error:
                diagnostics.log(diagnostics.record('bootstrap', 'unexpected_failure', error))
                raise ScanFailure(str(error)) from None
            process = None
            try:
                async with asyncio.timeout(SCAN_TIMEOUT):
                    async with PublicScanProxy() as proxy:
                        args = [sys.executable, str(Path(__file__).with_name('scanner.py')),
                                '--url', url, '--proxy', proxy.url,
                                '--diagnostic', str(diagnostic_path)]
                        stage = 'process_spawn'
                        if scanner_platform.is_windows():
                            process = await scanner_platform.spawn_windows(args, work, env)
                        else:
                            # Fixed browser lifecycle debug namespace only. Its raw output
                            # is privately drained and reduced to allowlisted exit fields.
                            env['DEBUG'] = 'pw:browser'
                            process = await asyncio.create_subprocess_exec(*args,
                                cwd=work, env=env, start_new_session=True,
                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                        read_task = asyncio.create_task(read_report(process))
                        exit_task = asyncio.create_task(read_browser_exit(process))
                        try:
                            code = await scanner_platform.wait_with_workspace_limit(process, work)
                            raw, overflow = await read_task
                            browser_exit = await exit_task
                        except BaseException:
                            read_task.cancel()
                            exit_task.cancel()
                            await asyncio.gather(read_task, exit_task, return_exceptions=True)
                            raise
                        data = child_diagnostic(diagnostic_path)
                        if code != 0:
                            if not data:
                                data = diagnostics.record('bootstrap', 'process_failed')
                            elif data['reason'] in ('running', 'ok'):
                                data['reason'] = 'process_failed'
                            data['return_code'] = code
                            data.update(browser_exit)
                            data['proxy_failures'] = getattr(proxy, 'failures', {})
                            diagnostics.log(diagnostics.with_memory(data, memory_before))
                        if code == scanner_platform.CONTAINMENT_EXIT:
                            raise ScanFailure('scanner_containment_failed')
                        if code == scanner_platform.TIMEOUT_EXIT:
                            raise ScanFailure('scan_timed_out')
                        if code != 0:
                            raise ScanFailure(diagnostics.API_ERRORS.get(data['reason'], 'scanner_failed'))
                stage = 'report_read'
                if overflow or not raw or len(raw) > MAX_REPORT_BYTES:
                    raise ScanFailure('invalid_report')
                try:
                    return json.loads(raw)
                except (ValueError, TypeError):
                    raise ScanFailure('invalid_report') from None
            except TimeoutError:
                data = child_diagnostic(diagnostic_path)
                diagnostics.log(diagnostics.with_memory(
                    diagnostics.record(data['stage'] if data else stage, 'scan_timeout'), memory_before))
                raise ScanFailure('scan_timed_out') from None
            except scanner_platform.PlatformError as error:
                diagnostics.log(diagnostics.record(stage, 'resource_limit', error))
                raise ScanFailure(str(error)) from None
            except (OSError, ValueError) as error:
                child = child_diagnostic(diagnostic_path)
                actual_stage = child['stage'] if child and stage == 'process_spawn' else stage
                diagnostics.log(diagnostics.record(actual_stage, diagnostics.classify(actual_stage, error), error))
                raise ScanFailure('scanner_failed') from None
            finally:
                # Always dispose descendants before deleting their temporary directory.
                if process:
                    if scanner_platform.is_windows():
                        try:
                            await process.close()
                        except scanner_platform.PlatformError as error:
                            diagnostics.log(diagnostics.record('cleanup', 'cleanup_failed', error))
                            raise ScanFailure(str(error)) from None
                    else:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                        await process.wait()
        finally:
            try:
                await scanner_platform.cleanup_workspace(temporary)
            except (scanner_platform.PlatformError, OSError) as error:
                diagnostics.log(diagnostics.record('cleanup', 'cleanup_failed', error))
                raise ScanFailure('scanner_cleanup_failed') from None
