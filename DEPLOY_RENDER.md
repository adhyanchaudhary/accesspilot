# Render backend trial

This prepares the backend for a Render Docker web service; it does not establish
that Render supports Chromium's required sandbox or has enough free-tier memory.
Do not enable public scanning until a real scan succeeds with the sandbox intact.
No deployment has been performed by adding these files.

## 1. Choose the exact code to deploy

Use a branch containing your working backend. MongoDB Atlas stores scan results;
sessions and active jobs still live in memory and disappear on restart. The
current background scanner must use one worker and one replica.

Review and push Dockerfile, .dockerignore, render.yaml, backend/serve.py and this
documentation after testing. No .env, PEM file, webhook credential, or backend URL
belongs in the commit. The frontend proxy is a separate next step; these files do
not change Netlify or its build.

## 2. Create a Render service

In Render, choose **New > Blueprint**, connect the GitHub repository and choose
the deployment branch. The root render.yaml creates a free Docker web service.
Alternatively choose **New > Web Service**, Docker runtime, repository root as
the build context, Dockerfile path ./Dockerfile, free instance, and /health probe.
Leave the Docker command unset so the image CMD runs.

Enter prompted environment values in Render's dashboard:

| Variable | Value |
| --- | --- |
| FRONTEND_ORIGIN | Your exact Netlify HTTPS origin, without a trailing slash |
| GITHUB_CALLBACK_URL | Your Netlify origin plus /api/auth/github/callback |
| GITHUB_APP_ID | Existing App ID |
| GITHUB_CLIENT_ID | Existing App client ID |
| GITHUB_CLIENT_SECRET | Existing secret |
| GITHUB_APP_SLUG | Existing App slug |
| GITHUB_PRIVATE_KEY | PEM contents as a secret; literal backslash-n escapes are supported |
| N8N_WEBHOOK_URL | Existing production webhook URL |
| N8N_WEBHOOK_SECRET | Existing webhook authentication secret |
| MONGO_URI | Atlas connection string, stored as a secret |
| MONGO_DATABASE | accesspilot, or your existing database name |
| MONGO_SCAN_COLLECTION | scan_results, or your existing collection name |

Do not set GITHUB_PRIVATE_KEY_PATH to a path on your laptop. Do not override
PLAYWRIGHT_BROWSERS_PATH with a Windows path: the image installs its own browser
at /opt/playwright. PORT is provided by Render and is read by backend.serve.
Secure cookies and disabled API docs are enforced by that launcher. It keeps
access logging and proxy-header trust disabled, and binds on 0.0.0.0.

Configure Atlas network access for Render's outbound addresses. Without MONGO_URI,
the backend uses a null scan repository and does not persist scan results.

## 3. Connect the public URLs without committing them

After deploying, save the assigned backend HTTPS URL in n8n's AccessPilot Config.
Keep the existing job-scoped Authorization header on every service request.
Set explicit HTTP timeouts, and unpin old Webhook data before submitting a job.

The Netlify same-origin /api proxy still needs to be implemented using a build
script that reads BACKEND_URL from Netlify environment settings. Set frontend
VITE_API_BASE_URL=/api. Netlify does not substitute $BACKEND_URL in toml redirects.
Do not switch directly to cross-site browser cookies as a workaround.

Once the proxy is configured, set the GitHub App callback to the same
GITHUB_CALLBACK_URL entered above. Test that redirects and Set-Cookie headers
survive the proxy, browser write requests preserve Origin and X-CSRF-Token, and
authenticated responses retain Cache-Control: no-store.

## 4. Acceptance checks

1. Direct Render /health returns 200. /docs, /redoc and /openapi.json return 404.
2. Browser GitHub login and logout work through Netlify's /api proxy.
3. Unauthenticated /service/jobs/... requests fail, even with browser cookies.
4. Submit a fresh audit for a controlled public site and an authorized test repo.
   Confirm a real audit object reaches n8n and review scanner diagnostic codes.
5. Confirm Chromium runs with chromium_sandbox=True, the scan completes within
   its timeout, and the service does not restart from memory exhaustion.
6. Test the draft-PR step only on a repository you control and review its diff.

An HTTP health check alone does not test Chromium. If you see
scanner_sandbox_unavailable, the host runtime does not meet the current scanner
requirements. Do not add --no-sandbox, privileged execution, or remove network
guards. Use a compatible host instead. If Render kills the process for memory,
reduce workload or choose a larger instance; concurrency is already one.

## Operational limits

- Free services can sleep and cold-start. A cold start can make n8n requests time
  out. Opening /health before a demo helps but is not an availability guarantee.
- Redeploys and restarts interrupt in-process scans. This checkout loses all
  sessions/jobs on restart; previously delivered machine credentials then fail.
- /health reports API readiness, not browser compatibility or database health.
- Render's infrastructure may collect request metadata independently of the
  disabled Uvicorn access log. Restrict log access and inspect provider logging
  controls; OAuth callbacks include a short-lived code in the query string.
- This is a single-instance demo configuration, not durable production hosting.

## Local container test (Docker required)

From the repository root:

```bash
docker build -t accesspilot-backend .
docker run --rm --init -p 8000:8000 --env-file backend/.env accesspilot-backend
```

Use container-compatible environment settings: provide GITHUB_PRIVATE_KEY rather
than a laptop file path, and remove any local PLAYWRIGHT_BROWSERS_PATH override.
The deployment launcher always sets secure cookies, so browser OAuth must use
HTTPS. Use the unchanged backend.run launcher for ordinary HTTP local development.
The host must allow Chromium's non-root sandbox; Docker's default seccomp or host
user-namespace policy may deny it. A successful local container test does not
establish compatibility with Render's runtime.
