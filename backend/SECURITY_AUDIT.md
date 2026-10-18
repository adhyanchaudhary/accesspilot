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
  GitHub read; fresh checks run on each request. There are no GitHub write endpoints.
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
