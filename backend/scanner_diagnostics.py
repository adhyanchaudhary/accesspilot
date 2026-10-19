"""Allowlisted scanner diagnostics. Never serialize exception messages, URLs or paths."""
import importlib.metadata
import json
import logging
import re
import sys

STAGES = {'bootstrap', 'dependencies', 'driver_start', 'browser_launch', 'context_setup',
          'navigation', 'axe', 'report_write', 'report_read', 'process_spawn', 'cleanup', 'complete'}
REASONS = {'running', 'ok', 'dependency_missing', 'dependency_load_failed', 'browser_missing',
           'sandbox_unavailable', 'browser_launch_failed', 'browser_profile_failed', 'browser_dependency_failed', 'driver_start_failed', 'context_setup_failed',
           'navigation_timeout', 'proxy_connection_failed', 'dns_failed', 'certificate_failed',
           'navigation_failed', 'axe_failed', 'report_write_failed', 'report_read_failed',
           'process_failed', 'process_spawn_failed', 'containment_failed', 'resource_limit',
           'scan_timeout', 'cleanup_failed', 'unexpected_failure'}
EXCEPTIONS = {'Error', 'TimeoutError', 'OSError', 'FileNotFoundError', 'ModuleNotFoundError',
              'ImportError', 'PermissionError', 'ValueError', 'TypeError', 'RuntimeError',
              'TargetClosedError', 'NotImplementedError', 'JSONDecodeError', 'PlatformError'}
DEPENDENCY_ROOTS = {'playwright', 'axe_playwright_python', 'greenlet', 'pyee',
                    'typing_extensions', 'httpx', '_winapi', '_overlapped', 'msvcrt'}


def dependency_name(value):
    if (isinstance(value, str) and len(value) <= 128
            and re.fullmatch(r'[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)*', value)
            and value.split('.')[0] in DEPENDENCY_ROOTS):
        return value
    return None


API_ERRORS = {'dependency_missing': 'scanner_dependency_missing', 'browser_missing': 'scanner_browser_missing',
              'sandbox_unavailable': 'scanner_sandbox_unavailable', 'navigation_timeout': 'scan_timed_out',
              'proxy_connection_failed': 'scanner_proxy_failed', 'dns_failed': 'scanner_dns_failed',
              'certificate_failed': 'scanner_tls_failed'}


def classify(stage, error):
    # Only match known fixed signatures; raw driver logs can contain URLs, tokens and page data.
    text = str(error).lower()
    if stage == 'dependencies':
        return 'dependency_missing' if isinstance(error, (ImportError, ModuleNotFoundError)) else 'dependency_load_failed'
    if stage == 'browser_launch':
        if 'crashpad_handler' in text and '--database is required' in text:
            return 'browser_profile_failed'
        if 'error while loading shared libraries' in text or 'host system is missing dependencies' in text:
            return 'browser_dependency_failed'
        if any(part in text for part in ("executable doesn't exist", 'executable does not exist', 'browser executable not found')):
            return 'browser_missing'
        if any(part in text for part in ('no usable sandbox', 'sandbox is not supported',
                                        'failed to move to new namespace', 'sandbox_host_linux',
                                        'zygote_host_impl_linux', 'suid sandbox helper', 'setuid_sandbox')):
            return 'sandbox_unavailable'
        if 'chrome-sandbox' in text and 'fatal' in text:
            return 'sandbox_unavailable'
        return 'browser_launch_failed'
    if stage == 'navigation':
        if 'err_proxy_connection_failed' in text or 'err_tunnel_connection_failed' in text:
            return 'proxy_connection_failed'
        if 'err_name_not_resolved' in text:
            return 'dns_failed'
        if 'err_cert_' in text or 'err_ssl_' in text:
            return 'certificate_failed'
        if type(error).__name__ == 'TimeoutError':
            return 'navigation_timeout'
        return 'navigation_failed'
    return {'driver_start': 'driver_start_failed', 'context_setup': 'context_setup_failed',
            'axe': 'axe_failed', 'report_write': 'report_write_failed',
            'report_read': 'report_read_failed', 'process_spawn': 'process_spawn_failed',
            'cleanup': 'cleanup_failed'}.get(stage, 'unexpected_failure')


def record(stage, reason, error=None, return_code=None):
    result = {'stage': stage if stage in STAGES else 'bootstrap',
              'reason': reason if reason in REASONS else 'unexpected_failure',
              'platform': sys.platform if sys.platform in ('win32', 'linux', 'darwin') else 'other',
              'python': f'{sys.version_info.major}.{sys.version_info.minor}'}
    if error is not None:
        missing = dependency_name(getattr(error, 'name', None)) if isinstance(error, ModuleNotFoundError) else None
        if missing:
            result['missing_module'] = missing
        name = type(error).__name__
        result['exception'] = name if name in EXCEPTIONS else 'Exception'
        for field in ('errno', 'winerror'):
            value = getattr(error, field, None)
            if type(value) is int:
                result[field] = value
    if stage == 'browser_launch' and error is not None:
        match = re.search(r'exitCode=(-?[0-9]{1,10})', str(error))
        if match:
            result['browser_exit_code'] = int(match.group(1))
    if type(return_code) is int:
        result['return_code'] = return_code
    try:
        version = importlib.metadata.version('playwright')
        if re.fullmatch(r'[0-9]{1,4}(?:\.[0-9]{1,4}){1,3}(?:(?:a|b|rc)[0-9]{1,4})?', version):
            result['playwright'] = version
    except importlib.metadata.PackageNotFoundError:
        pass
    return result


def validate(data):
    if (not isinstance(data, dict) or not isinstance(data.get('stage'), str)
            or not isinstance(data.get('reason'), str)
            or data['stage'] not in STAGES or data['reason'] not in REASONS):
        return None
    result = {'stage': data['stage'], 'reason': data['reason']}
    for field in ('errno', 'winerror', 'return_code', 'browser_exit_code'):
        if type(data.get(field)) is int and -(2**31) <= data[field] <= 2**32 - 1:
            result[field] = data[field]
    if isinstance(data.get('exception'), str) and data['exception'] in EXCEPTIONS | {'Exception'}:
        result['exception'] = data['exception']
    if isinstance(data.get('platform'), str) and data['platform'] in ('win32', 'linux', 'darwin', 'other'):
        result['platform'] = data['platform']
    missing = dependency_name(data.get('missing_module'))
    if missing:
        result['missing_module'] = missing
    counts = data.get('proxy_failures')
    if isinstance(counts, dict):
        result['proxy_failures'] = {name: count for name, count in counts.items()
            if name in {'policy_denied', 'dns_failed', 'connection_failed', 'timeout', 'protocol_error'}
            and type(count) is int and 0 <= count <= 10000}
    for field in ('python', 'playwright'):
        if isinstance(data.get(field), str) and re.fullmatch(r'[0-9]{1,4}(?:\.[0-9]{1,4}){1,3}(?:(?:a|b|rc)[0-9]{1,4})?', data[field]):
            result[field] = data[field]
    return result


def write(path, data):
    if path:
        try:
            with open(path, 'w', encoding='utf-8', newline='\n') as stream:
                json.dump(validate(data), stream)
        except OSError:
            pass  # Scanner failure still propagates via exit status.


def log(data):
    safe = validate(data)
    if safe:
        logging.getLogger('accesspilot.scanner').warning('scanner_diagnostic %s', json.dumps(safe, sort_keys=True))
