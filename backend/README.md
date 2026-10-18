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
No status/results or GitHub source-read/write routes are implemented yet.

```json
{
  "schema_version": 1,
  "job_id": "server-generated UUID",
  "website_url": "https://example.com",
  "repository": {
    "id": 7, "installation_id": 3, "full_name": "owner/site",
    "private": true, "default_branch": "main"
  },
  "requested_by": 1
}
```

Backend checks public DNS addresses and HTTP(S) ports before dispatch. **The n8n
fetcher must independently enforce public egress** on every DNS resolution and redirect,
including subresources, block internal/metadata IPs, and bound crawl size/time.
Preflight DNS validation alone cannot prevent DNS rebinding. Never let an LLM choose
unrestricted network destinations or forward authentication headers across redirects.
n8n should deduplicate job_id. Network timeouts leave acceptance unknown; there is no
automatic retry. Durable idempotent submission/reconciliation remains future work.

n8n Cloud **cannot call localhost on your laptop**. This local backend initiates outbound
HTTPS to n8n; it sends no GitHub token and exposes no public token endpoint. The two
Gemini agents, source retrieval and result delivery must be configured separately.
For later local source retrieval/results, use a local outbound polling worker connected
to a protected cloud queue/result store, so no inbound tunnel is needed. Alternatively,
use an authenticated HTTPS development tunnel with an authenticated, job-scoped callback,
request signatures, timestamp/replay checks and strict size limits before enabling callbacks.
Do not expose an unauthenticated tunnel or forward browser sessions to n8n.

## Future remediation contract (design only; not implemented routes)

Persist each job with its authenticated user ID, installation/repository IDs, approved
base branch and immutable base SHA. A local outbound worker can retrieve a Git tree and
bounded source blobs after rechecking both user and installation access. Give Agent 1
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
pagination, CSRF, upstream failures and private URL rejection. A local process smoke
check verifies startup and /health. Live OAuth consent, app credentials/installations,
repository listing against GitHub and the configured n8n workflow require your credentials
and manual end-to-end testing; test passes do not establish those external integrations.
