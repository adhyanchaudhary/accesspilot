# AccessPilot local end-to-end test (Windows 11)

Run live testing manually after reviewing changes. Automated tests mock GitHub/n8n;
they never create real branches, commits or PRs. A live audit **does** create a draft
PR when n8n submits valid changes. Use the authorized demo repository, not production.

## Install from the repository root

Use Python 3.12+ and Node.js 20.19+ (or 22.12+), npm, and cloudflared installed from
Cloudflare's official distribution. Do not mix localhost and 127.0.0.1 in browser URLs.
PowerShell activation is optional; use the virtual environment interpreter explicitly:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
$env:PLAYWRIGHT_BROWSERS_PATH = "C:\playwright-browsers"
.\.venv\Scripts\python.exe -m playwright install chromium
if (!(Test-Path backend\.env)) { Copy-Item backend\.env.example backend\.env }
if (!(Test-Path frontend\.env)) { Copy-Item frontend\.env.example frontend\.env }
Push-Location frontend
npm ci
npm test
npm run typecheck
npm run build
Pop-Location
.\.venv\Scripts\python.exe -m pytest backend\tests -q
```

Edit backend/.env locally. Set GITHUB_APP_ID, GITHUB_CLIENT_ID,
GITHUB_CLIENT_SECRET, GITHUB_APP_SLUG, and GITHUB_PRIVATE_KEY_PATH to your existing
private key's absolute Windows path. Never put credentials in chat, screenshots,
frontend/.env, version control or agent prompts. Also set N8N_WEBHOOK_URL to the
active workflow's production HTTPS webhook and N8N_WEBHOOK_SECRET to the existing
header secret checked by that workflow (`X-AccessPilot-Secret`). Set MONGO_URI to a
MongoDB Atlas SRV connection string for a dedicated database user, and keep
MONGO_DATABASE/MONGO_SCAN_COLLECTION at their defaults unless you need separate names.

Keep these local settings:

```dotenv
FRONTEND_ORIGIN=http://localhost:3000
GITHUB_CALLBACK_URL=http://localhost:8000/auth/github/callback
COOKIE_SECURE=false
```

frontend/.env contains **only** `VITE_API_BASE_URL=http://localhost:8000`.
All VITE variables become public browser code. Restart servers after changing env.

In GitHub Developer Settings → GitHub Apps → AccessPilot, verify that exact OAuth
callback, Contents read/write and Pull requests read/write repository permissions.
Approve any installation permission update; install on accesspilot-demo-store.
The signing key must belong to that App. The signed-in user also needs repository
push permission for remediation. Never replace the App flow with a PAT.

## Start three separate PowerShell terminals

All commands below start from the repository root. Keep one backend process; no
reload or multiple workers (sessions, jobs and idempotency are in memory).

Backend:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "C:\playwright-browsers"
.\.venv\Scripts\python.exe -m backend.run --tunnel
```

Frontend:

```powershell
cd frontend
npm run dev
```

Tunnel, only when ready to test:

```powershell
cloudflared tunnel --url http://127.0.0.1:8000
```

The backend still listens only on loopback. Open the browser at
`http://localhost:3000`, not the tunnel hostname. OAuth callback stays localhost.
Check `Invoke-RestMethod http://localhost:8000/health`; expect status ok. In tunnel
mode /docs, /redoc and /openapi.json must return 404. Proxy headers do not authorize
requests. Never run a static file server over the repository or enable wire logs.

## Update n8n every time the Quick Tunnel restarts

n8n Cloud cannot reach your localhost. Copy the newly printed **HTTPS**
`https://<random>.trycloudflare.com` base into the trusted backend-base setting used
by **all three** n8n HTTP Request nodes (tree, source, remediation). If URLs are
configured separately, update each. It is not VITE_API_BASE_URL or
N8N_WEBHOOK_URL; neither changes when the tunnel hostname changes. Activate/publish
the intended n8n workflow and use its production webhook; a test webhook needs a
manual listener and is unsuitable for normal submissions.

Use the original webhook envelope (usually `body`) for job_id and
source_service.credential, not Gemini output. Existing contract:

- `GET <base>/service/jobs/<job_id>/tree`
- `GET <base>/service/jobs/<job_id>/source?path=<URL-encoded exact pinned path>`
- `POST <base>/service/jobs/<job_id>/remediation`

Every request has `Authorization: Bearer <original source_service.credential>`;
keep redirects off. GitHub tokens are generated only inside the backend. Do not
send this job credential to Gemini or the frontend. Restrict execution-history
access/retention: n8n webhook/node data may contain the credential. Never share raw
execution exports or authorization headers.

The backend webhook payload has schema_version, job_id, website_url, repository
(id, installation_id, full_name, default_branch, private), requested_by, base_sha,
**audit** (actual axe violations/nodes/evidence and summary), and source_service
(credential, expires_at, tree_path, source_path). Agent 1 identifies paths from
findings and the pinned tree; Agent 2 receives retrieved source. Its final changes
must be validated/mapped into this exact remediation body:

```json
{
  "changes": [{"file_path": "src/App.tsx", "updated_code": "complete replacement source", "issue_ids": ["image-alt"]}],
  "unresolved_issues": ["Manual keyboard review required"]
}
```

No repository, branch, token or base-commit overrides. Existing frontend source
only; 1–10 files, 24 KiB combined UTF-8 code, 32 KiB total HTTP JSON body. Configs,
new files, duplicates, binary files, empty/no-op changes and stale bases are rejected.
Do not automatically retry ambiguous failures or split changes into multiple commits.
For zero candidate changes, do **not** call remediation with an empty list or invent
a fix. This prototype has no n8n completion callback for no-change/agent failures;
its browser will remain waiting until job expiry if no remediation call occurs.
Inspect n8n manually in that case.

## Real-data checklist

1. Click Start a scan to open the connection panel. No OAuth navigation should happen
   until you click Connect my GitHub. Consent on GitHub and return to the localhost
   dashboard. An existing session instead shows Connected as @username with Continue
   to dashboard and Disconnect; disconnect ends the local session, not App authorization. Browser /auth/github/me
   should return your user and CSRF token. Only an opaque HttpOnly cookie is stored.
2. Open the dashboard and refresh repositories after installation. Only backend-
   authorized repositories should appear. Select the correct accesspilot-demo-store.
3. Enter `https://accpilot.netlify.app/`. Confirm this deployed site's source matches
   the selected repository. Changing the default branch after submission intentionally
   causes a stale-base conflict; submit a fresh audit instead.
4. Submit **once**, record the job ID. Network /audits must return 202 promptly with
   a job ID; POST has credentials, X-CSRF-Token and Idempotency-Key. Retries of the
   same request reuse the key; an intentional new scan gets a fresh key.
5. Observe queued → scanning → dispatching → submitted (polling may skip fast states).
   Expand actual violation IDs, impact, selectors, HTML and failure evidence. HTML
   must display as text. No score is calculated. Empty findings mean only that axe
   detected no violations on that page; manual testing is still necessary.
6. `submitted` means n8n accepted delivery, **not** AI completion. Open the actual
   n8n execution; match job_id and verify real audit, tree/source retrieval, both
   Gemini steps and the final remediation HTTP response. Keep credentials hidden.
7. Once remediation succeeds, the next browser poll must show completed and a real
   draft PR URL, branch and commit SHA. Open the link from AccessPilot.
8. In GitHub verify the PR is a **draft**, targets the original default branch,
   changes only expected existing source files and contains one new commit on
   accesspilot/remediation-<job-id>. Review the diff, test the demo and rerun axe.
   Do not merge unreviewed agent code. The default branch must remain untouched.
9. Repeat layout checks at desktop and mobile widths; verify empty repository,
   failure and sign-out states. Expired sessions should require sign-in again.
10. Stop cloudflared when finished. Restarting the backend loses jobs/sessions and
    invalidates job credentials; log in again and submit a fresh audit.

## Safe failure diagnosis

- 401: session expired/missing; sign in. Machine endpoints require job Bearer auth,
  not cookies. 403: check CSRF+Origin for browser POST, live App installation/user
  permission and job expiry for service calls. Do not remove checks.
- 409: pinned base moved, conflicting retry, external branch edit or ambiguous remote
  outcome. Inspect the existing job branch/PR before deciding on a fresh audit.
- 422/413: validate public website URL and exact source paths/body sizes.
- 429/503: respect development rate/queue capacity, check missing configuration;
  retry later without generating duplicate scans. 502: check sanitized backend and
  n8n error status; do not print upstream headers/bodies.
- scanner_dependency_missing: install requirements with the **same** virtualenv
  interpreter used to run backend. The safe stage/module diagnostic identifies known
  missing modules. pip check does not check browser binaries.
- scanner_browser_missing: install Chromium with the same PLAYWRIGHT_BROWSERS_PATH
  in the backend terminal. Keep browser sandbox and egress guard enabled.
- Scanner navigation/TLS/network failure: verify the public deployment and safe
  diagnostic stage. Never disable TLS checks, private-network blocking or timeouts.
- Workflow fails before remediation: browser cannot infer that failure. Inspect n8n;
  no fabricated PR or completion is shown. An authenticated remediation HTTP failure
  is reported separately from scan status; partial branch work can remain.

Current validation is mocked/local Linux. Live Windows Chromium, OAuth consent,
Cloudflare routing, n8n/Gemini and real GitHub writes require the checklist above.

## Check the dark code-review workspace

No n8n node, webhook payload or remediation response needs changing. After pulling
this update, restart backend/frontend and submit a **fresh** audit; older completed
jobs have no recorded preview. When remediation confirms a draft PR, check:

- The results workspace displays actual changed paths, green + additions, red −
  deletions, old/new line numbers, context and the pinned base/confirmed commit.
- Selecting another file changes the diff; Copy patch copies only the visible patch.
- The changes request is GET /audits/{job_id}/changes with browser cookies and no
  machine Bearer credential. It is not reissued on every status poll.
- Compare the shown changes with that exact GitHub draft commit. They remain proposed
  changes; the viewer does not merge, edit, execute or verify generated code.
- Review at mobile width: file navigation stacks above the editor and long code
  scrolls inside it. The landing page keeps its original theme.
- Oversized/protected previews say unavailable, not zero changes. The PR link remains
  available. Errors offer Retry preview without repeating remediation.
- A signed-out browser cannot read the endpoint; another user cannot read the job.
