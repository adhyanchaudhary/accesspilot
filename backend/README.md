# AccessPilot local backend

Python 3.12+, FastAPI, PyJWT/cryptography, httpx and python-dotenv. Run commands
from the repository root. This is a local, single-worker implementation. No frontend
is included in this previously empty checkout.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
# Edit backend/.env with your configuration; never commit it or the PEM.
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

Use `--no-access-log` to avoid logging OAuth callback codes and state. Do not enable
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
  eventual remediation workflow; Metadata read is implicit. Current backend tokens
  are deliberately restricted to Contents read on one repository.
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
| POST /audits | Session + CSRF + Origin | 202 `{ "job_id": "UUID", "status": "accepted" }` |
| POST /auth/logout | Session + CSRF + Origin | `{ "status": "logged_out" }` |

Interactive OpenAPI documentation is at `/docs`. Errors use `{ "detail": ... }`:
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
const response = await fetch(`${api}/audits`, {
  method: 'POST', credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrf_token },
  body: JSON.stringify({ website_url: 'https://example.com',
    installation_id: selected.installation_id, repository_id: selected.id })
});
// Handle non-2xx explicitly. Logout uses the same CSRF header.
```

## n8n Cloud integration

Set N8N_WEBHOOK_URL to the **production HTTPS webhook URL** of your active n8n
workflow. Configure its Header Auth credential to require `X-AccessPilot-Secret`
with the same strong random value as N8N_WEBHOOK_SECRET. Enter credentials securely
on both sides. The browser never receives the URL's private configuration or header.
Protect n8n execution logs and restrict workflow editors; the payload contains repository
metadata and website URLs. Never place secrets in website URLs.

POST /audits currently **dispatches** this authenticated payload and requires a 2xx
acknowledgement. Configure n8n to acknowledge quickly after accepting the job.
A 202 means accepted by n8n, not that an accessibility audit or remediation completed.
Job-scoped source-read routes are available below. No status/results or GitHub write routes are implemented.

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
Preflight DNS validation alone cannot prevent DNS rebinding. Never let an LLM choose
unrestricted network destinations or forward authentication headers across redirects.
n8n should deduplicate job_id. Network timeouts leave acceptance unknown; there is no
automatic retry. Durable idempotent submission/reconciliation remains future work.

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
one hour or at owner-session expiry, whichever occurs first. Logout, restart or a failed/
timed-out dispatch invalidates access. A timeout can still mean n8n accepted the payload,
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
unchanged. Frontend audit responses still contain only job_id and status.

### Reaching the local service securely from n8n

n8n Cloud **cannot call localhost on your laptop**. No tunnel is created by this code.
Choose one of these integration patterns:

1. **HTTPS callback route:** run an authenticated development tunnel or reverse proxy
   to the local backend, exposing only `/service/jobs/*` with GET allowed. Terminate
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

## Future remediation contract (design only; not implemented routes)

Jobs now capture user, installation/repository IDs and an immutable snapshot in memory.
Future remediation needs durable storage of this context and reviewed proposals. The
source service retrieves the pinned tree and bounded blobs after checking access. Give Agent 1
only audit findings + a bounded tree; validate its candidate paths against that tree.
Give Agent 2 only approved source files and findings. Treat both agents' output as
untrusted data; exclude secrets and binary/generated files.

A future `POST /jobs/{job_id}/proposals` accepts an authenticated worker result:
`{schema_version:1, base_sha, changes:[{path, original_blob_sha, proposed_content}], summary}`.
Worker authentication must be separate from browser sessions and scoped to the job;
require replay protection and idempotency. This route must not accept arbitrary
repository IDs, remote URLs, tokens or shell commands. Validate file count/size/path
limits, reject traversal, symlinks, workflows and sensitive files, and store a reviewable diff.

A future `POST /jobs/{job_id}/approve` accepts `{proposal_id, expected_base_sha}` from
the job owner with CSRF protection. Recheck current user and installation access plus
write permission, verify unchanged base SHA, and require explicit review. Only then mint
a narrowly scoped write token, create a server-named `accesspilot/<job-id>` branch,
commit approved changes, and open a **draft** PR. Never push to the default branch,
force-push or accept arbitrary GitHub API operations. Store commit/PR IDs for idempotency.
No GitHub writes or agent executions are performed by the current backend/tests.

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
