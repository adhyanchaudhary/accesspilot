# Development tunnel security audit

Scope: current FastAPI backend, its GitHub/OAuth authentication, n8n submission and
source-read service. No tunnel, deployment or real GitHub mutation was performed.
Controls were tested locally with mocked GitHub/n8n. This is a code/configuration
audit, not a live network penetration test or a dependency-advisory certification.

Use `python -m backend.run --tunnel`; `TUNNEL_MODE=true` also selects the tunnel
profile when using that launcher. Merely starting cloudflared against the old process
does not activate these changes. The app remains on loopback; the launcher does not
start a tunnel.

| Check | Finding and resulting control |
| --- | --- |
| Machine authentication | Both source routes require a random per-job Bearer credential. Browser sessions alone, invalid/cross-job credentials, expired jobs and logged-out owners are denied. No new token retrieval route exists. |
| Credential exposure | No configuration, installation-token, key or OAuth-secret response route. Only an opaque cookie reaches the browser; n8n receives a separate job credential. GitHub errors are sanitized. Source text never includes PEM private-key blocks. |
| Documentation | Was enabled; `/docs`, `/redoc`, OAuth docs redirect and `/openapi.json` now return 404 in tunnel mode. Local documentation is preserved. |
| Debug/logs | Debug explicitly false. Safe launcher disables access logging; application suppresses HTTP/access loggers. Errors exclude exception values and tracebacks. OAuth query codes must also be excluded from external gateway logs. |
| CORS | Exactly the configured frontend origin, with credentials. Wildcard, credential-bearing and path-bearing origin configurations are rejected. CORS is not relied on as machine authentication. |
| Repository scope | Each read rechecks owner session/user identity, app installation membership, and both user and installation repository grants. A fresh Contents-read installation token is scoped to one repository. The job pins commit/tree SHAs; paths resolve to blobs in that tree. Caller-provided repository/ref parameters cannot change scope. |
| CSRF | POST /audits and POST /auth/logout require the matching session token and exact frontend Origin. OAuth state is single-use, expiring and bound to an HTTP-only cookie, with PKCE. Existing OAuth tests pass. |
| Resource limits | Added actual inbound-byte limits, deadlines, streamed upstream-byte caps, bounded DNS lookup/connections and development rate limits. Existing source/tree limits, blob hashes, UTF-8 checks and no-redirect HTTP policy remain. Pending job access is revoked on failed/timed-out dispatch. Background scan work is separately bounded and never extends an HTTP request deadline. |
| Sensitive files | No static/directory/file-serving routes. Direct .env/.pem/.git URLs return 404. Source policy excludes dotfiles, PEM extensions, credential filenames, traversal, symlinks and submodules. Added PEM private-key content detection even under an otherwise allowed filename. |
| Proxy trust | Safe launcher explicitly sets proxy_headers=False and binds loopback. Application Host checks permit localhost/127.0.0.1 and Quick Tunnel hosts in tunnel mode; forwarding/Cloudflare headers do not establish identity, authorization, callbacks or rate-limit buckets. |

## Test evidence

Current result after scanner integration: **117 passed**, including existing OAuth,
source-service, tunnel and new scanner/job/network tests, with
one dependency deprecation warning. Run `python -m pytest backend/tests -q`.
The original 48 tests are retained, covering
JWT/OAuth/session and GitHub authorization as well as pinned source retrieval. Added
security tests exercise the tunnel profile, every service route's authentication,
forbidden file URLs, CORS/CSRF, proxy/server settings, rate limits, generic errors and
log suppression, actual body limits (including chunked/misdeclared lengths), request/
upstream deadlines, upstream size limits, private-key content filtering and pending-job
revocation on timeout. Tests do not create real branches, commits or PRs.

## Remaining risks and suitability

Suitable for a **temporary authenticated development tunnel**, using the hardened
launcher and HTTPS. No tunnel was started and no live Cloudflare/n8n connectivity was
certified by this audit. Keep OAuth/browser use local, limit tunnel lifetime and share
only with the intended workflow. A Quick Tunnel is internet reachable and its hostname
is not a secret or an access policy. Job endpoints enforce authentication themselves;
health and OAuth entry points remain publicly reachable.

- Job credentials are read capabilities reusable until expiry (at most one hour,
  also bounded by owner session), not one-time signed requests. A leaked credential
  grants that job's bounded source access while the owner remains authorized. Protect
  n8n execution retention, workflow editors, node headers, agent inputs and proxy logs.
- Source filtering is not comprehensive secret detection. Non-PEM secrets embedded in
  ordinary authorized repository source could be returned to n8n/Gemini. Review the
  repository and obtain permission to process private source before running agents.
- Jobs, scan queue, sessions and rate counters live in one process. Restart revokes access and
  loses jobs; there is no durable queue, distributed limit or production DDoS defense.
  Public callers can consume the global development request budget. GitHub/n8n quotas
  and latency remain external constraints.
- The backend now runs a single-page Playwright scan behind a public-IPv4-only proxy
  that checks DNS and pins actual connections for navigation, redirects and subresources.
  Its browser has sandboxing enabled, no app credentials, and bounded process lifetime/
  output/network traffic. Chromium download was blocked by the environment allowlist,
  so only mocked scanner/security tests passed here; no live browser isolation claim
  is made. Any separate n8n crawler must independently enforce public egress and limits.
  Untrusted pages can consume memory or exploit browser bugs; a worker container/OS
  sandbox with memory limits and a network firewall is recommended before broader use.
- Remote user/installation revocation cannot atomically interrupt an already in-flight
  GitHub read; fresh checks run on each request. The job-scoped draft-remediation write route is described in the follow-up below.
- Runtime settings matter: use the launcher, keep debug/request tracing off in other
  tools, and do not configure a static server over the checkout. A future public
  browser deployment needs HTTPS-only cookies, updated OAuth settings, persistent
  protected storage, stronger abuse controls and a separate deployment review.

## Windows scanner compatibility follow-up

The scanner now supports native Windows using child-owned Job Objects (CPU limit and
kill-on-close descendant containment), a credential-free Windows environment with
installed browser-cache discovery, bounded output, monitored temporary disk usage and
reparse-safe handle reads. POSIX process-group/rlimit behavior is retained. Windows
file monitoring is not a kernel disk quota and may briefly overshoot between checks.
No browser-network, GitHub-authentication or n8n integration controls were removed.
Validation on Linux: **136 passed, 2 skipped**. Windows-specific mocked checks run
on all platforms; the two native Windows kernel tests are skipped on Linux. A real
Windows Chromium scan remains to be verified.

## Scanner failure diagnostics follow-up

Child stdout/stderr remain suppressed; failures are now reported through a small
private allowlisted status file and sanitized warning logs. No raw exceptions, URL/
query strings, credentials, paths or page data are logged. Missing dependencies,
browser builds, sandbox failures and proxy/navigation stages are distinguishable.
The DNS-deny rule excludes only the required loopback proxy address; loopback bypass
remains disabled and the public-address proxy policy is unchanged. Windows cleanup
also retries known transient share-lock/directory-not-empty errors within the same
bound. GitHub authentication and n8n integration are unchanged.

Validation: **149 passed, 2 skipped**. Real subprocess diagnostics were verified on
Linux, reporting a missing Playwright browser; the system browser's sandbox startup
also failed. No real Chromium scan succeeded and the user's exact Windows failure
remains unconfirmed. A fresh Windows diagnostic is required to establish that cause.

## User-site import visibility correction

Profile isolation previously changed Python's user-site location in the child despite
using the parent's exact sys.executable. The runner now preserves the trusted parent
user base explicitly with PYTHONUSERBASE when enabled, or preserves user-site disabling
with PYTHONNOUSERSITE. APPDATA/USERPROFILE/HOME remain isolated; arbitrary PYTHONPATH/
PYTHONHOME and credentials remain excluded. Diagnostics retain only allowlisted
ModuleNotFoundError.name values, never raw messages. GitHub and n8n are unchanged.

Validation: **160 passed, 2 skipped**. The regression includes real parent/child Python
processes and controlled user-site packages. No live Windows Chromium success is claimed.
The historical missing module cannot be recovered from old diagnostics that omitted
its name; a fresh failure now identifies a known scanner dependency precisely.

## Job-scoped draft remediation follow-up

POST /service/jobs/{job_id}/remediation shares the exact worker auth and live owner/
repository checks used by source reads. It additionally requires user push permission,
verified installation Contents/Pull requests write grants and a single-repository
write token. Targets, branch names and base commits come only from the server job.
Only bounded, existing frontend source paths in the verified pinned tree are writable;
config/protected/binary paths, no-op files, secrets and request overrides are rejected.

One tree and one commit feed a unique job branch using force:false; only a draft PR
is created. Titles/bodies contain server-controlled IDs/counts, not agent text or
credentials. Same-job retries are locked and fingerprinted; ambiguous Git object
creation fails closed. Lost PR/ref replies are reconciled only against expected remote
objects. Tests mock all GitHub writes; no real branch/commit/PR creation was performed.

The existing job credential now conveys bounded write access to authorized push users;
n8n must protect it accordingly. State is in memory, and failures may leave branches
or unreferenced objects. There is no rollback or distributed exactly-once guarantee.
GitHub cannot atomically lock the default ref across all calls: base checks detect
staleness at each visible-write boundary but do not eliminate a concurrent-ref race.

Remediation validation result: **199 passed, 2 native-Windows tests skipped** for the
full backend suite. New mocked checks cover success, multiple-file single commits,
permissions, body/path/job/repo mismatches, binary source, stale/default/ref conflicts,
concurrent retries, ambiguous responses and known credential rejection. No live GitHub
writes were attempted.
