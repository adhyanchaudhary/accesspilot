"""Bounded scanner subprocess and lossless axe-core report normalization."""
import asyncio
import json
import os
import signal
import stat
import sys
import tempfile
from pathlib import Path

from .scan_network import PublicScanProxy
from . import scanner_platform

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


class ScannerRunner:
    async def __call__(self, url):
        temporary = tempfile.TemporaryDirectory(prefix='accesspilot-scan-')
        work = temporary.name
        try:
            output = Path(work) / 'audit.json'
            # Strict per-platform allowlist; never copy application credentials.
            try:
                env = scanner_platform.scanner_environment(work)
            except scanner_platform.PlatformError as error:
                raise ScanFailure(str(error)) from None
            process = None
            try:
                async with asyncio.timeout(SCAN_TIMEOUT):
                    async with PublicScanProxy() as proxy:
                        args = [sys.executable, str(Path(__file__).with_name('scanner.py')),
                                '--url', url, '--output', str(output), '--proxy', proxy.url]
                        if scanner_platform.is_windows():
                            process = await scanner_platform.spawn_windows(args, work, env)
                        else:
                            process = await asyncio.create_subprocess_exec(*args,
                                cwd=work, env=env, start_new_session=True,
                                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
                        code = await process.wait()
                        if code == scanner_platform.CONTAINMENT_EXIT:
                            raise ScanFailure('scanner_containment_failed')
                        if code == scanner_platform.TIMEOUT_EXIT:
                            raise ScanFailure('scan_timed_out')
                        if code != 0:
                            raise ScanFailure('scanner_failed')
                with scanner_platform.open_report(output) as stream:
                    info = os.fstat(stream.fileno())
                    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_REPORT_BYTES:
                        raise ScanFailure('invalid_report')
                    raw = stream.read(MAX_REPORT_BYTES + 1)
                if len(raw) > MAX_REPORT_BYTES:
                    raise ScanFailure('invalid_report')
                return json.loads(raw)
            except TimeoutError:
                raise ScanFailure('scan_timed_out') from None
            except scanner_platform.PlatformError as error:
                raise ScanFailure(str(error)) from None
            except (OSError, ValueError):
                raise ScanFailure('scanner_failed') from None
            finally:
                # Always dispose descendants before deleting their temporary directory.
                if process:
                    if scanner_platform.is_windows():
                        try:
                            await process.close()
                        except scanner_platform.PlatformError as error:
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
            except scanner_platform.PlatformError as error:
                raise ScanFailure(str(error)) from None
