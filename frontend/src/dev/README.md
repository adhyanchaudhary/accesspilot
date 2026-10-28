# Local audit UI preview

From the repository root, run `npm ci --prefix frontend` then
`npm run dev --prefix frontend`. Open `/dev/audit-preview` on the address Vite
prints (normally http://localhost:5173/dev/audit-preview).

This development-only page bypasses the application session provider and injects
local sample data into the real findings and diff components. It makes no backend,
GitHub, or n8n requests. Use the state selector to view proposed changes, no issues,
a workflow failure, or pending changes. Sample changes are not real remediation.

The dynamic preview import is guarded by `import.meta.env.DEV`; production builds
do not include it. `npm run preview` serves a production build and will not show
this page. The production authentication and audit routes are unchanged.
