const ERROR_MESSAGES: Record<string, string> = {
  scanner_failed: 'The scanner could not complete the audit for this page.',
  scanner_browser_missing: 'The scanning browser is not installed on the backend host.',
  scanner_dependency_missing: 'A scanner dependency is missing on the backend host.',
  scanner_proxy_failed: 'The scanner could not reach the page through its network guard.',
  scanner_dns_failed: 'The website hostname did not resolve to a public address.',
  scanner_tls_failed: 'The website presented an untrusted TLS certificate.',
  scanner_sandbox_unavailable: 'The backend could not start its browser sandbox.',
  scanner_containment_failed: 'The backend could not contain the browser process.',
  scanner_environment_invalid: 'The backend scanner environment is misconfigured.',
  scanner_cleanup_failed: 'The scanner could not clean up its temporary files.',
  scan_timed_out: 'The page took too long to render within the scan deadline.',
  scan_resource_limit: 'The page exceeded the scanner’s resource limits.',
  invalid_report: 'The scanner returned an unusable accessibility report.',
  authorization_expired: 'Your GitHub authorization expired before the scan ran.',
  authorization_failed: 'Repository authorization could not be confirmed.',
  dispatch_rejected: 'The remediation workflow rejected the audit payload.',
  dispatch_unknown: 'The audit was sent, but the workflow did not confirm receipt.',
  backend_stopped: 'The backend restarted or stopped while the audit was queued.',
}

/**
 * Turns a safe backend error code into a human-readable explanation.
 * The raw code is preserved separately for developer-facing display.
 */
export function describeAuditError(code: string | null): {
  title: string
  body: string
} {
  if (!code) {
    return {
      title: 'The audit failed',
      body: 'No further detail was reported by the backend.',
    }
  }
  return {
    title: 'The audit failed',
    body: ERROR_MESSAGES[code] ?? 'The backend reported an unexpected failure.',
  }
}
