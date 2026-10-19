# AccessPilot local backend

Python 3.12+, FastAPI, PyJWT/cryptography, httpx and python-dotenv. Run commands
from the repository root. This is a local, single-worker implementation. The React/TypeScript/Vite frontend lives in `frontend/`.
See [LOCAL_E2E_TEST.md](../LOCAL_E2E_TEST.md) for Windows setup and the real-data checklist.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
# Install browser binaries and OS libraries as described in the scanner section below.
cp backend/.env.example backend/.env
# Edit backend/.env with your configuration; never commit it or the PEM.
python -m backend.run
```

The launcher disables access logs and proxy-header trust. Do not enable
HTTP request-body/header debug logs. Environment variables override backend/.env.
The PEM can be supplied via `GITHUB_PRIVATE_KEY_PATH` (recommended, chmod 600) or
`GITHUB_PRIVATE_KEY`. Never send it to the frontend or n8n. An unreadable configured
key path fails startup; absent credentials allow health but protected GitHub operations
return 503. The app binds locally. For cloud onboarding internal smoke checks use local
HTTP requests; the cloud machine's localhost is separate from your laptop's localhost.

```bash
python -m pytest backend/tests -q
curl -f http://localhost:8000/health
```

## GitHub Developer Settings: manual configuration

Under your existing **GitHub App**, configure:

- Homepage: `http://localhost:3000` for local development.
- User authorization callback: `http://localhost:8000/auth/github/callback` exactly.
- App ID, Client ID and generated Client Secret in backend/.env. These are distinct
  values. Set `GITHUB_APP_SLUG` to the app's URL slug and configure its private key.
- Repository permissions: Contents read/write and Pull requests read/write for the
  eventual remediation workflow; Metadata read is implicit. Read tokens are restricted to Contents read on one repository; remediation requests
  a separate single-repository Contents/Pull requests write token.
- Install the app on the intended repositories. Permission changes can require
  installation owner approval. User OAuth consent alone does not install the app.
- Expiring user tokens may stay enabled. This backend requires login again on expiry
  or revocation; it does not store refresh tokens or silently extend sessions.
- No GitHub webhook receiver or setup callback is required. After installation,
  return to the frontend and refresh repository selection. An installation ID from
  a redirect is never treated as authorization.

Login uses the GitHub App user authorization flow (not a standalone OAuth App),
with random ten-minute, single-use state bound to an HTTP-only browser cookie and
PKCE S256. Sessions rotate on login and expire within eight hours or user-token expiry.
Only random opaque session IDs are stored in cookies. Tokens remain in process memory.
Restart/reload clears sessions and pending OAuth state; use **one worker**. For deployment,
replace stores with shared encrypted storage, add rate limits and a durable job queue,
use HTTPS and COOKIE_SECURE=true. Never use local cookie settings for deployment.

Every repository operation checks the user's live `/user/installations` membership
for this app and `/user/installations/{id}/repositories`. Audit submission also requests
a fresh token scoped to the selected repository and confirms the installation grant.
App-wide installation listing exists only as a server helper, not a public route.
Pagination is supported; exceeding its safety cap fails closed. GitHub 401s require
login again; 403s can indicate authorization, SSO, suspension or rate limits. Upstream
messages and tokens are never echoed. Logout removes this browser's local session;
it does not revoke the user's GitHub App authorization or other sessions.

## Frontend API

Frontend origin must be `http://localhost:3000` (use localhost consistently, not
127.0.0.1). Cookies use HttpOnly, SameSite=Lax, path=/ and local HTTP Secure=false.
CORS permits credentials only from FRONTEND_ORIGIN. Requests use
`credentials: 'include'`. Start OAuth and installation with **browser navigation**, not fetch.

| Method / path | Authentication | Result |
| --- | --- | --- |
| GET /health | None | `{ "status": "ok" }` process readiness |
| GET /health/github | Session | App credential API check; no credentials returned |
| GET /auth/github/login | None | Redirect to GitHub; establishes OAuth state cookie |
| GET /auth/github/callback | State + browser cookie | Exchanges code, creates session, redirects to frontend |
| GET /auth/github/me | Session | `{ "user": {"id": 1, "login": "alice"}, "csrf_token": "..." }` |
| GET /github/install | Session | Redirect to app installation page |
| GET /github/repositories | Session | `{ "repositories": [{"id": 7, "installation_id": 3, "full_name": "owner/site", "private": true, "default_branch": "main"}] }` |
| POST /audits | Session + CSRF + Origin | 202 `{ "job_id": "UUID", "status": "queued" }` (or existing job status on deduplication) |
| GET /audits/{job_id} | Session; job owner only | `{job_id, status, error, summary, audit, remediation}`; remediation is `null`, `{status: "in_progress", branch, commit_sha?}`, `{status: "failed", error}`, or `{status: "completed", branch, commit_sha, pr_url}` |
| POST /auth/logout | Session + CSRF + Origin | `{ "status": "logged_out" }` |

Interactive OpenAPI documentation is at `/docs` in the local profile only; tunnel mode disables it. Errors use `{ "detail": ... }`:
401 login/expired token, 403 forbidden/CSRF, 422 invalid input, 502 upstream failure,
503 missing configuration. `/health/github` is authenticated to prevent anonymous
users consuming the GitHub App's API quota.

```js
window.location.assign('http://localhost:8000/auth/github/login');
// After returning from OAuth:
const api = 'http://localhost:8000';
const me = await fetch(`${api}/auth/github/me`, { credentials: 'include' }).then(r => r.json());
const { repositories } = await fetch(`${api}/github/repositories`, {
  credentials: 'include'
}).then(r => r.json());
const selected = repositories[0]; // Let the user choose from this list.
const submissionKey = crypto.randomUUID(); // Reuse this key if this submission is retried.
const response = await fetch(`${api}/audits`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token,
    'Idempotency-Key': submissionKey },
  body: JSON.stringify({ website_url: 'https://example.com',
    installation_id: selected.installation_id, repository_id: selected.id })
});
// Handle non-2xx explicitly. Logout uses the same CSRF header.
const { job_id } = await response.json();
// Poll every few seconds while queued/scanning/dispatching; stop on submitted/failed.
const status = await fetch(`${api}/audits/${job_id}`, { credentials: 'include' }).then(r => r.json());
```

## n8n Cloud integration

Set N8N_WEBHOOK_URL to the **production HTTPS webhook URL** of your active n8n
workflow. Configure its Header Auth credential to require `X-AccessPilot-Secret`
with the same strong random value as N8N_WEBHOOK_SECRET. Enter credentials securely
on both sides. The browser never receives the URL's private configuration or header.
Protect n8n execution logs and restrict workflow editors; the payload contains repository
metadata and website URLs. Never place secrets in website URLs.

POST /audits authenticates the selection, pins the commit, queues a background scan,
and returns 202 immediately after queue admission (GitHub/URL preflight still runs in
that request). The worker runs `backend/scanner.py`, captures audit.json and validates
it before sending this authenticated payload. A 202 means **queued locally**, not yet
accepted by n8n. Job status becomes `submitted` only after n8n returns 2xx; this still
does not mean Gemini remediation completed. The bounded draft-remediation endpoint is documented below.

```json
{
  "schema_version": 1,
  "job_id": "server-generated UUID",
  "website_url": "https://example.com",
  "repository": {
    "id": 7, "installation_id": 3, "full_name": "owner/site",
    "private": true, "default_branch": "main"
  },
  "requested_by": 1,
  "base_sha": "40-character commit SHA resolved by the backend",
  "audit": {
    "schema_version": 1,
    "requested_url": "https://example.com",
    "testEngine": {"name": "axe-core", "version": "scanner-supplied version"},
    "violations": [{
      "id": "image-alt", "impact": "critical",
      "description": "Images must have alternative text",
      "nodes": [{"html": "<img src=\"hero.png\">", "target": ["#hero img"],
        "any": [{"id": "has-alt", "message": "Element has no alt attribute"}],
        "all": [], "none": []}]
    }],
    "summary": {"violation_count": 1, "affected_element_count": 1}
  },
  "source_service": {
    "credential": "server-generated per-job machine credential",
    "expires_at": 1800000000,
    "tree_path": "/service/jobs/<job-id>/tree",
    "source_path": "/service/jobs/<job-id>/source"
  }
}
```

Backend checks public DNS addresses and HTTP(S) ports before dispatch. **The n8n
fetcher must independently enforce public egress** on every DNS resolution and redirect,
including subresources, block internal/metadata IPs, and bound crawl size/time.
The backend scanner uses the guarded pinned-IP proxy described below; preflight DNS
validation alone cannot prevent DNS rebinding for any separate n8n crawler. Never let an LLM choose
unrestricted network destinations or forward authentication headers across redirects.
n8n must deduplicate job_id (also sent as the Idempotency-Key header) in a persistent
store before invoking agents. The backend makes one webhook attempt per job; ambiguous
timeouts set a failed/dispatch_unknown status and revoke its source credential, without
retrying. Durable queue restoration and delivery reconciliation remain future work.

### Scanner setup and background job lifecycle

The existing single-page scanner lives at **backend/scanner.py**. It still uses synchronous
Playwright and axe-playwright-python. Its changes preserve the full native axe result
instead of the earlier lossy `issue_id`/`failed_code` list, add browser network guards,
and remove its hard-coded localhost webhook. Only the backend queue dispatches n8n.
There is no manual file upload or browser-selectable local file path.

Install pinned dependencies, Chromium and its supported Linux libraries on the host
that runs FastAPI (Linux, macOS or native Windows 11):

```bash
pip install -r backend/requirements.txt
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright"
python -m playwright install chromium
# On supported Linux hosts, install required system libraries with admin approval:
# python -m playwright install-deps chromium
# Set the same absolute PLAYWRIGHT_BROWSERS_PATH in backend/.env for later runs.
python -m backend.run --tunnel
```

On **Windows 11 / PowerShell**, use the same virtual environment/interpreter that
runs FastAPI. If Chromium is already installed for that interpreter, reuse it:

```powershell
.\.venv\Scripts\Activate.ps1
python -m pip install -r backend/requirements.txt
# Only if the matching Playwright browser is not already installed:
# python -m playwright install chromium
python -m backend.run --tunnel
```

The runner discovers Windows' default `%LOCALAPPDATA%\ms-playwright` cache before
isolating the child environment. Explicit `PLAYWRIGHT_BROWSERS_PATH` overrides it;
use the same absolute path used during installation (`0` for Playwright's bundled
location is also supported). Do not change HOME/LOCALAPPDATA globally to work around
browser discovery. Required SystemRoot/WINDIR are preserved, while browser profiles,
TEMP/TMP, APPDATA and USERPROFILE point to the private scan workspace. GitHub/OAuth/
n8n credentials and other inherited variables remain excluded.

Native Windows no longer returns `scanner_requires_posix`. It uses a shell-free
Popen launcher, compatible with Windows Selector and Proactor loops, and establishes
a **Windows Job Object before any browser process starts**. The job enforces a
60-second aggregate user-CPU limit; kill-on-close terminates Chromium descendants when
the scanner exits normally, times out, is cancelled or is terminated by the parent.
An independent child watchdog also bounds wall time. If Windows/corporate containment
policies prevent job assignment, scanning fails closed with `scanner_containment_failed`;
do not disable the browser sandbox or job containment as a workaround. A missing
SystemRoot fails with `scanner_environment_invalid`.

POSIX retains process-group cleanup, per-process CPU limits and RLIMIT_FSIZE. Windows
has no equivalent RLIMIT_FSIZE: reports are bounded to 4 MiB **before writing** (and
2 MiB before acceptance), while a 100 ms monitor limits browser temp files to 4 MiB
per file / 64 MiB total / 4,096 entries and rejects reparse points. Monitor limits can
briefly overshoot between checks. Windows report reads open without following reparse
points and deny concurrent writes/deletes. Cleanup retries briefly for Windows file
locks; persistent failures report `scanner_cleanup_failed`. Browser cache/resource
limit violations report `scan_resource_limit`. These controls do not replace a hard
OS disk quota or a memory sandbox for hostile public use.

Windows launch/timeout/environment/handle protections have mocked regression coverage.
Native kernel descendant-cleanup tests run only on Windows:

```powershell
python -m pytest backend/tests/test_windows_scanner.py -q
```

This implementation was tested on Linux; the Windows-native tests and live Windows
Chromium launch were **not executed here**. Existing Chromium restrictions, certificate
verification, public-only proxy, report normalization and tunnel hardening are unchanged.

### Windows user-site dependency visibility

The launcher uses **sys.executable**, not a PATH lookup for `python`: if FastAPI runs
under `C:\Python313\python.exe`, that is also the scanner interpreter. Previously,
however, the child did **not** necessarily have the same import paths. Redirecting
APPDATA/USERPROFILE/HOME to the private browser workspace changed Python's default
user base and hid packages installed under the real profile's
`AppData\Roaming\Python\Python313\site-packages`. `pip check` and successful imports
in the parent do not check that changed child environment. `httpx` is not a scanner
child dependency.

The fixed launcher captures the parent's `site.getuserbase()` as **PYTHONUSERBASE**
when user-site imports are enabled, before isolating the browser's profile. If the
parent disables user-site imports (for example a normal virtual environment or `-s`),
PYTHONNOUSERSITE=1 preserves that restriction. It still excludes inherited PYTHONPATH,
PYTHONHOME and application credentials; it does not copy the parent's arbitrary
sys.path or restore real APPDATA/USERPROFILE for Chromium. Global/venv packages keep
the same interpreter-managed paths, and supported per-user packages remain available.

The scanner's direct imports are `playwright.sync_api` and
`axe_playwright_python.sync_playwright`; Playwright also imports dependencies such as
`pyee` and `greenlet`. Checking just `import playwright` or
`import axe_playwright_python` need not exercise those imports. A safe parent check is:

```powershell
C:\Python313\python.exe -c "from playwright.sync_api import sync_playwright; from axe_playwright_python.sync_playwright import Axe; print('scanner imports OK')"
```

Dependency diagnostics now retain the exact allowlisted **ModuleNotFoundError.name**,
for example `"missing_module":"greenlet"`; they do not infer names from exception
text or expose raw messages/paths. Supported names include scanner packages and their
known transitive modules. Unknown names are omitted rather than logging arbitrary
strings. Previous diagnostics discarded this attribute, so the module that failed on
a past Windows run cannot be identified from `ModuleNotFoundError` alone. If another
failure occurs after restart, a fresh diagnostic will distinguish its missing module.

Validation: **160 passed, 2 native Windows tests skipped**. A real Python subprocess
regression verifies the same interpreter, reproduces hidden user-site packages, and
verifies visibility with the fix while profile isolation remains active. This does
not constitute a successful live Windows Chromium scan; that remains unverified.

### Diagnosing `scanner_failed` safely

`example.com` is a valid public smoke-test target. The URL does not have to match
its selected repository to scan, though resulting remediation would not be meaningful
for an unrelated repository. A mismatch does not explain a Chromium startup failure.

Previously every child exception exited with code 1 and stdout/stderr were discarded,
so dependency import, browser launch, navigation, axe and report failures were all
indistinguishable. The runner now reads a small private structured status file and
logs **one allowlisted diagnostic** to the backend console on failure. Raw driver
stdout/stderr remain discarded. Diagnostic records contain stage, fixed reason code,
exception type, Python/Playwright version and numeric OS/browser/child exit codes
when available. Proxy failures are counts under fixed categories, never destinations.
They contain no URL/query, local path, environment values, request/response headers,
exception message, stack trace, page HTML or credentials. The status file is bounded,
read with the same no-symlink/reparse protections as reports and removed with the
workspace. No public debug endpoint is added.

Example safe output (illustrative):

```text
scanner_diagnostic {"stage":"browser_launch","reason":"browser_missing","exception":"Error","platform":"win32","return_code":1}
```

| Stage / reason | Next check |
| --- | --- |
| dependencies / dependency_missing | Use the same Python interpreter/venv as FastAPI; install backend/requirements.txt there. |
| browser_launch / browser_missing | `python -m playwright install chromium` in that venv; another installation/channel or missing headless-shell build does not establish that the required Playwright binary exists. Verify the configured browser-cache path matches installation. |
| browser_launch / sandbox_unavailable | Fix host sandbox support/policy. Do not add --no-sandbox or turn off Job Object containment. |
| browser_launch / browser_launch_failed | Inspect the safe browser_exit_code if present; check installed browser/driver compatibility and Windows libraries. No raw browser logs are exposed. |
| browser_launch / browser_profile_failed | Check that the isolated temporary profile is writable; do not point it at a real browser profile. |
| driver_start / driver_start_failed | Check Python/Playwright installation and process policy; the wrapper still uses shell-free Popen on Windows. |
| navigation / proxy_connection_failed | Check local firewall/endpoint protection permits Chromium to contact its ephemeral 127.0.0.1 proxy. The DNS-deny rule now explicitly excludes **only 127.0.0.1**, letting Chromium resolve the configured proxy; all destination requests still traverse the checked public-only proxy with loopback bypass disabled. |
| navigation / navigation_failed | Check fixed proxy_failures counts: policy_denied, dns_failed, connection_failed, timeout or protocol_error. Do not relax private-address restrictions or allow a direct fallback. |
| navigation / certificate_failed | Repair the host's certificate trust using supported configuration, never ignore HTTPS errors. |
| navigation / navigation_timeout | Target did not load within the unchanged navigation deadline. |
| axe / axe_failed | Engine injection/execution failed after navigation; report is not dispatched. |
| report_read or report_write | Output is missing, malformed, blocked by filesystem permissions or exceeds existing limits. |
| cleanup / cleanup_failed | Browser files remained locked after bounded Windows sharing-violation/directory-not-empty retries. |

Some failures now have specific safe API codes such as `scanner_browser_missing`,
`scanner_dependency_missing`, `scanner_proxy_failed`, `scanner_dns_failed`,
`scanner_tls_failed` and `scanner_sandbox_unavailable`. Other failures retain
`scanner_failed`, but the diagnostic identifies their stage. No diagnostic contains
the job's GitHub or n8n secrets, and no GitHub/OAuth/n8n behavior was changed.

After updating, restart `python -m backend.run --tunnel`, then create a **fresh** audit
with a new Idempotency-Key. An old failed job/idempotency key intentionally keeps its
old result. If the job still fails, use its safe diagnostic line to determine the
Windows-specific cause. Do not paste raw browser/HTTP logs or secret values.

Validation for this update: **149 passed, 2 native-Windows tests skipped** on Linux.
A real default scanner subprocess reported browser_launch/browser_missing here.
The available system Chromium separately failed its enabled-sandbox startup check
(sandbox_unavailable). **No real Chromium accessibility scan succeeded**, and the
specific Windows failure remains unconfirmed until a fresh Windows run provides its
stage/reason. The proxy DNS exclusion is corrected, but it has not been demonstrated
to be the cause of the reported Windows failure. No live integration success is claimed.

Chromium runs with its **sandbox enabled**. The host must support it; do not add
`--no-sandbox` to bypass a failure. Browser downloads require `cdn.playwright.dev`
and any official download redirect destinations permitted by your network policy.
TLS/artifact verification must stay enabled. On this cloud instance Python dependency
installation succeeded, but Chromium download returned 403 "Domain forbidden" for
cdn.playwright.dev. No live browser scan or live n8n integration has been validated.
The guarded proxy needs outbound TCP to checked public IPv4 ports 80/443; this managed
environment may require supported egress configuration. It never falls back to an
unvalidated corporate/platform proxy or bypasses an access denial.

`SCAN_CONCURRENCY` defaults to 2 (allowed 1..4), `SCAN_QUEUE_SIZE` to 20 (allowed
1..100). The single FastAPI process owns a fixed worker pool and bounded queue.
A full queue returns 503. Browser work runs in a separate process group in a private
temporary directory; audit.json is read with size/type checks and deleted afterward.
The child environment excludes application credentials. Timeout, cancellation and
shutdown kill the scanner/browser process group. No scan is executed in an HTTP
request or in an unbounded thread/background-task pool.

Job states: **queued → scanning → dispatching → submitted**, or **failed**. Poll
GET /audits/{job_id} with the submitting user's session; another user receives 404.
The response includes `error`, `summary` (violation/affected-element counts when
available), `audit: {violations: [...]}` once scanned, and an optional safe `remediation` view (status, safe failure code, branch/SHA/draft PR URL only),
never machine credentials, raw scanner logs, fingerprints, pending write state or
internal webhook details.
`submitted` means n8n accepted the payload, not that agents finished or fixed code.
Missing browser binaries/libraries/sandbox support produce `scanner_failed`; other
safe codes include `scan_timed_out`, `invalid_report`, `authorization_expired`,
`authorization_failed`, `dispatch_rejected`, `dispatch_unknown` and `backend_stopped`.
A failed scan/report never sends an empty fake audit to n8n. Zero findings are valid
only when axe actually reports an empty violations array.

Send a fresh **Idempotency-Key** per intentional submission; reuse it for transport
retries. Keys are scoped to the submitting session. Reusing a key with different input
returns 409; reuse with the same input returns its existing job, including failures,
without rescanning or resubmitting. If omitted, the same session + URL + repository
input reuses the existing job for its lifetime (up to one hour); use a new explicit
key for an intentional rescan. Concurrent submissions reserve atomically, and duplicate
queue deliveries skip already claimed jobs. There is no automatic retry after scan or
webhook failure. Restart loses jobs/idempotency state and revokes credentials: this
is a development queue, not a durable exactly-once delivery service.

Each worker rechecks user identity and GitHub grants before scanning and before
n8n dispatch. The authorized repository/base commit chosen at admission never changes.
The report is JSON-only, at most 2 MiB, with validated violation IDs/impact/descriptions,
node HTML/selectors and check-evidence shapes. Native `id`, `impact`, `description`,
`helpUrl`, `nodes[].html`, `nodes[].target`, `failureSummary` and `any/all/none` evidence
(including nested data/related nodes) stay intact, along with other axe metadata.
`audit.schema_version`, `requested_url` and `summary` are added. Agent 1 must use
**audit.violations**, not infer findings from counts or expect the old `failed_code`
format. Treat HTML/selectors/evidence as untrusted text, never rendered HTML or executable
instructions. Report validation rejects missing findings rather than silently treating
a malformed scanner result as zero violations.

Network safety is enforced on the **actual socket connection**, not just a DNS preflight:
all Chromium HTTP/HTTPS traffic goes through a per-scan loopback forward proxy. Each
connection resolves the destination, rejects private/reserved/mixed DNS results and
Azure's platform IP, then connects to the checked public IPv4 address without a second
hostname lookup. This applies to navigation, redirects, frames and subresources.
Only HTTP port 80 and HTTPS CONNECT port 443 are allowed. IPv6-only/transition routes
are unsupported. Chromium loopback proxy bypass, direct DNS/QUIC and non-proxied WebRTC
UDP are disabled; WebSockets, service workers, downloads, non-HTTP schemes and methods
other than GET/HEAD are blocked. HTTPS certificate verification remains enabled.

Scan limits: 30-second page navigation, 60-second scanner wall time, POSIX per-process
CPU limit or Windows Job Object aggregate CPU limit,
120-second whole-job deadline, 16 proxy connections, 32 MiB aggregate proxy traffic,
15-second proxy idle timeout, 4 MiB report-write limit and 2 MiB report cap. POSIX
also applies RLIMIT_FSIZE; Windows monitors per-file and aggregate temporary data as above.
Sites requiring login, WebSockets, service workers, POST APIs or private resources can
fail or render partially under this read-only public-page policy. Findings describe
the page that was successfully rendered, not proof that every resource loaded.
Browser bugs and extreme page memory use remain risks: for untrusted public users,
run workers in an OS/container sandbox with memory/CPU limits and a public-only network
firewall as an additional boundary. No OS isolation or public deployment was created
by this integration.

### Job-scoped repository source service

Audit submission resolves the authorized repository's default branch to an immutable
commit SHA and tree SHA **before** dispatch. There is no browser-selectable ref or
repository override for source requests. Each job stores the submitting user's ID,
installation/repository IDs, owner session, pinned snapshot and SHA-256 hash of a new
256-bit random machine credential. The raw credential goes only to the authenticated
n8n webhook, never to browser responses; it is distinct from both the browser session
and N8N_WEBHOOK_SECRET. No GitHub tokens leave the backend.

Both service endpoints require `Authorization: Bearer <source_service.credential>`.
Cookies alone fail. A credential can read only its own job and expires after at most
one hour or at owner-session expiry, whichever occurs first. Logout, restart, scanner failure or a failed/
timed-out dispatch invalidates access. Source access is enabled only during dispatch
and after submission, not while scanning. A timeout can still mean n8n accepted the payload,
but further source retrieval is denied. Credentials are reusable for reads until expiry;
protect them as secrets, exclude them from logs/agent prompts, restrict n8n editors and
disable/redact execution-data retention for this workflow. Only pass source text and
paths to Gemini, not the full webhook payload or HTTP headers.

Every service request verifies the current session owner, live GitHub user identity,
user's membership in this app's installation, user repository grant, and installation
repository grant. It mints a fresh, short-lived GitHub Contents-read token restricted
to that repository. Revoked/expired user authorization or installation access fails
closed; n8n cannot keep reading solely by knowing a job or installation ID.

| Service route | Response |
| --- | --- |
| GET /service/jobs/{job_id}/tree | `{job_id, base_sha, files:[{path, sha, size}]}` |
| GET /service/jobs/{job_id}/source?path=src/App.tsx | `{job_id, base_sha, path, blob_sha, text}` |

Agent 1 uses the tree's paths to nominate files. Agent 2 receives only validated file
text. Source retrieval looks up the exact path in the pinned tree and fetches its
blob by SHA, never a client-provided ref/SHA/URL. Branch changes cannot move an existing
job. Responses include no download URLs or installation tokens. Standard errors include
401 missing machine authentication or expired GitHub authorization; 403 invalid/cross-job
credential, expired job/owner or revoked access; 404 file absent; 413 incomplete or
oversized tree; 422 invalid blob text; and 502 upstream failure.

The service returns regular UTF-8 source files only, with a 256 KiB per-file limit
and 10,000 tree-entry limit. Truncated GitHub trees are rejected. Symlinks, submodules,
binary/NUL-containing files, hidden paths, traversal, dependency/build directories,
and common credential filenames are excluded. See `job_sources.py` for allowed
extensions. Blob size and Git object hash are checked before returning text. This is
not a secret scanner: review the repository before sending source to cloud agents;
a secret embedded in an ordinary source file can still be returned. No local checkout,
arbitrary GitHub URL fetching, code execution, commits or PR creation is involved.

Jobs and sessions remain in single-process memory (up to 1,000 active jobs); use one
worker, avoid reload during jobs, and finish within the owner's session lifetime.
A production queue/persistent encrypted store and job renewal/cancellation are outside
this integration. Existing browser login, repository listing and logout contracts are
unchanged. Frontend submission responses still contain only job_id and status; polling exposes
a safe failure code and count summary, never worker credentials or raw exception text.

### Hardened Quick Tunnel profile

Before exposing a development instance, start the backend with:

```bash
python -m backend.run --tunnel
```

This **starts only FastAPI**, never cloudflared or a tunnel. Stop an older backend
instance yourself before binding the same port. Alternatively set `TUNNEL_MODE=true`
in the environment and use `python -m backend.run`. Use the same process for local
OAuth/audit submission and tunneled source calls: jobs and sessions are in memory.
The default local profile retains API docs for development.

The tunnel profile disables `/docs`, `/redoc`, `/docs/oauth2-redirect` and
`/openapi.json`, explicitly disables debug, restricts Host to localhost, 127.0.0.1 or
`*.trycloudflare.com`, and permits only the exact FRONTEND_ORIGIN in CORS. No static
file routes exist. Job service routes still require their own expiring Bearer
credentials; a random tunnel hostname is not authentication. Public `/health` and
OAuth login/callback remain available, protected as described above. Prefer gateway
path restrictions to `/service/jobs/*` if your tunnel setup supports them. Do not
claim that Quick Tunnel provides Cloudflare Access authentication by itself.

The launcher binds **127.0.0.1:8000**, disables access logs, uses one worker, caps
connections at 32 and keep-alive at five seconds, and sets **proxy_headers=False**.
Do not replace it with Uvicorn defaults (which can trust loopback proxy headers).
The application does not use Forwarded, X-Forwarded-* or CF-* as authentication or
rate-limit identity. Callback and frontend URLs come from settings, not Host headers.
Keep HTTP request/response debug logging and cloudflared request tracing disabled;
redact secrets in any gateway logging. Application HTTP/access loggers are suppressed
and errors return generic messages without exception strings or debug tracebacks.

Limits: 32 KiB actual request bodies, including chunked/misdeclared bodies; 4 KiB URLs;
16 KiB application header limit; 60-second total request deadline; five-second DNS
lookup timeout; 20-second total outbound request deadline; 8 MiB decoded upstream
response cap (64 KiB for OAuth and n8n acknowledgement); 16 outbound connections.
Existing 256 KiB source-file and 10,000-entry tree limits also apply. Deadline expiry
returns 504; delivery failure/cancellation revokes the pending job's credential.
Tunnel mode additionally has a **global** 120 requests/minute limit and 10 OAuth
logins/minute cap, returning 429. These are single-process development limits, not a
production abuse-control service; spoofed forwarding/IP headers cannot bypass them.
Ordinary source files containing PEM private-key markers are rejected as well.

Keep frontend and OAuth on localhost for this setup, with local HTTP cookies as
configured. n8n uses HTTPS plus its per-job machine credential to the tunnel. If you
later move **browser OAuth** onto a public HTTPS host, use COOKIE_SECURE=true and
configure GitHub callback/frontend origins and cookie/CORS behavior for that deployment
separately. Do not send browser session cookies to n8n.

See [the security audit](SECURITY_AUDIT.md) for tested controls and remaining risks.

### Reaching the local service securely from n8n

n8n Cloud **cannot call localhost on your laptop**. No tunnel is created by this code.
Choose one of these integration patterns:

1. **HTTPS callback route:** run an authenticated development tunnel or reverse proxy
   to the local backend, allowing GET for tree/source and POST only for the remediation
   route described below. Terminate
   TLS, require an additional gateway machine identity if supported, and preserve the
   Authorization header for the backend's mandatory job-credential check. Keep browser
   OAuth/login endpoints local. Set a trusted HTTPS base URL in the n8n workflow
   configuration (for example `ACCESSPILOT_SOURCE_BASE_URL`, not user/agent input).
   Require this host at the gateway and do not allow redirects or arbitrary callback
   destinations. Rate-limit requests and redact Authorization/source bodies in logs.
   The HTTPS entry point is reachable, but no source request is anonymous.
2. **Outbound worker alternative (architecture only):** keep the backend loopback-only.
   A local polling worker consumes requests from a separately authenticated cloud queue,
   validates their job binding, calls these same loopback endpoints with the per-job
   credential, and uploads results to a protected per-job result channel. n8n interacts
   with that queue rather than localhost. Use queue ACLs, message expiry, deduplication,
   bounded paths/payloads and TLS; never put GitHub credentials in messages. The queue
   and polling worker are not implemented in this change.

In an n8n HTTP Request node, use the trusted base URL plus
`{{$json.source_service.tree_path}}`, method GET, and the header
`Authorization: Bearer {{$json.source_service.credential}}`. For a second HTTP Request
node, use `source_path` with a **query parameter** named `path` set to an exact nominated
tree entry. Retain the original webhook payload in a private workflow branch to supply
the credential to HTTP nodes; do not pass that branch to either Gemini agent. Keep
redirect following off to prevent sending the credential to another host. The paths
in the webhook are relative; no public URL is inferred from request Host headers.

## Job-scoped draft remediation (hackathon prototype)

n8n may call **POST /service/jobs/{job_id}/remediation** with the **same per-job Bearer
credential** used for tree/source. Browser cookies are insufficient. Use a trusted
Cloudflare HTTPS base URL configured in n8n, and the original webhook's job_id and
source_service.credential, never an agent-selected URL/job/token. Keep redirects off.
No new PAT or GitHub token belongs in n8n. Do not expose the credential to Gemini,
frontend code, execution logs or a PR body. This endpoint extends the existing job
credential to a bounded **write capability**, not just read access.

In an n8n HTTP Request node:

- Method: POST.
- URL: `https://YOUR-TUNNEL.trycloudflare.com/service/jobs/{{$('Webhook').item.json.body.job_id}}/remediation`
  (adjust the Webhook node name/input wrapper to your workflow).
- Header: `Authorization: Bearer {{$('Webhook').item.json.body.source_service.credential}}`.
- JSON body: build changes from the agent's proposed source text, using exact paths
  returned by the pinned-tree service. Do not pass an entire unvalidated agent response.

```json
{
  "changes": [{
    "file_path": "src/App.tsx",
    "updated_code": "export const App = () => <img src=\"hero.png\" alt=\"A garden\"/>;\n",
    "issue_ids": ["image-alt"]
  }],
  "issue_ids": ["image-alt"],
  "unresolved_issues": ["A manual keyboard check remains"]
}
```

The list must contain 1–10 changed files. Per-file/root issue_ids are optional lists
of at most 50 short IDs. unresolved_issues is optional, at most 20 strings of 500
characters. Unknown fields—including repository, installation, branch, base SHA or
GitHub token overrides—are rejected. Limits: **24 KiB combined UTF-8 source** and the
existing **32 KiB actual HTTP body** (JSON escaping/metadata counts toward the latter).
Do not split a job into multiple commits: this route accepts one final changeset only.

200 response (illustrative):

```json
{
  "branch": "accesspilot/remediation-<job-uuid>",
  "commit_sha": "40-character Git commit SHA",
  "pr_url": "https://github.com/owner/repository/pull/123"
}
```

All target metadata comes from the server-side job. Only live dispatching/submitted
jobs with an unexpired credential and authenticated owner session are accepted.
The route reuses source authorization, checks current user push permission, verifies
this app installation grants **Contents:write and Pull requests:write**, and mints a
fresh token restricted to that one repository and those permissions. Ordinary source
reads continue to mint Contents:read tokens. If you changed GitHub App permissions,
the installation owner must approve them before this route can write.

Every file must already exist as a regular UTF-8 blob in the job's verified pinned
tree. Reads verify blob hashes; symlinks, submodules, new/deleted paths, duplicates
(including case collisions), binary/control characters, unchanged/blank files and
protected content are rejected. Write access is narrower than reads: existing frontend
HTML/CSS/JS/TS/JSX/TSX/Vue/Svelte/Astro sources only. Dotfiles, JSON/manifests/lockfiles,
config-named files, declarations, auth/security/API/infra/script directories, middleware
and service-worker files are excluded. Known job/server credentials and PEM/GitHub
credential patterns are rejected in proposed code; this is not comprehensive secret
or correctness detection. Human review of the resulting diff remains essential.

The server checks that the current default-branch name and tip still match the job,
checks the pinned commit's tree, creates a unique `accesspilot/remediation-<job-uuid>`
branch **from that pinned commit**, creates all files through one Git tree and **one
commit with the pinned commit as its only parent**, then fast-forwards only that
new branch (`force:false`). It verifies the resulting branch SHA and creates a
**draft** PR targeting the job's original default branch. No default-branch writes,
force pushes, arbitrary GitHub operations or PR-body text generated by an agent are
accepted. PR title/body/commit message are server templates with IDs/counts only.
Issue text, source code, website URLs and credentials are never inserted into PR text.

Retries are keyed by job_id and a canonical request hash under a per-job lock in the
existing job record. Concurrent identical calls share one result; a different changeset
for the same job returns 409. Confirmed tree/commit/ref steps are reused. A lost ref
update response can be reconciled against the expected SHA; a lost PR response can
be recovered only from a matching existing draft PR with the expected head/repo/base.
Pre-existing branches are never adopted, and altered branch tips fail closed.

**Limits of the prototype:** GitHub's multiple API calls are not a transaction. A
failed request can leave a job branch or unreferenced Git objects; there is no rollback.
An ambiguous tree/commit creation is **not retried**, preventing duplicate commits.
Ambiguous branch/PR creation without a safely verifiable result returns 409 and needs
manual reconciliation or abandonment of that job; do not clear state and blindly retry.
Idempotency is only for the live single-process job lifetime. Restart/expiry invalidates
the job and credential; no database, extra workers or multi-commit mode is introduced.
GitHub has no transaction/CAS spanning the default ref and PR creation: fresh-base
checks run before visible branch changes and PR creation, but cannot lock the default
branch against another actor between API calls. Strict cross-ref atomicity is a
platform limitation, not something this endpoint claims to provide.

Errors: 401 missing/expired authentication, 403 unauthorized user/installation or
missing permissions, 409 stale/mismatched SHA, conflicting retry, changed branch or
ambiguous outcome; 413 excessive size/incomplete tree; 422 invalid source/paths/schema;
502 sanitized GitHub failure. Use a fresh audit when the pinned default branch is
stale. Source endpoints, OAuth, scanning, browser CSRF and tunnel documentation/debug/
proxy protections remain unchanged. Permit this exact POST route at your HTTPS gateway;
a Quick Tunnel hostname alone supplies no authentication.

## Validation boundaries

Automated tests mock GitHub and n8n; they cover JWT signatures, scoped token requests,
OAuth state/cookie binding and replay/expiry, session expiry, repository authorization,
pagination, CSRF, upstream failures and private URL rejection. Job-source tests also
cover pinned commits, cross-job credential isolation, cookie-only rejection, expiry/
logout, owner identity and live grant revocation, source path/size policies, symlinks,
truncated trees, blob integrity and failed-dispatch credential revocation. A local process smoke
check verifies startup and /health. Live OAuth consent, app credentials/installations,
repository listing and source retrieval against GitHub, HTTPS routing, and the configured
n8n workflow require your credentials
and manual end-to-end testing; test passes do not establish those external integrations.

## Full-stack local validation

From `frontend/`, run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build`.
`npm run dev` uses strict port 3000. VITE_API_BASE_URL defaults to
http://localhost:8000; never put privileged credentials or a temporary tunnel hostname
in Vite configuration. The browser polls submitted jobs until a confirmed PR, an
authenticated remediation failure, or job expiry; submitted is not completion.
Only the owner sees actual scan findings and sanitized remediation result fields.
Evidence HTML is rendered as text, not inserted into the DOM.

Remediation errors do not change scan status: safe codes include authorization_failed,
conflict, payload_too_large, invalid_changes, github_unavailable and outcome_unknown. A failed attempt
can leave partial GitHub work; inspect n8n/branch state before retrying. A later
verified successful retry replaces the failure view. There is no completion callback
for upstream Gemini failures or zero-change workflows: absent a remediation request,
the browser keeps waiting until expiry. See the manual checklist for diagnosis.
