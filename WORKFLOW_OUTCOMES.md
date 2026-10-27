# Reporting workflow outcomes

Zero-violation scans now finish in FastAPI with status `completed`, save their report,
return remediation `{status: "no_changes", reason: "no_violations"}`, and skip n8n.
`submitted` still means the webhook accepted a scan with findings.

The following n8n edits must be made manually and published. Existing workflows
continue working, but cannot report no-change/failure outcomes until wired here.
No workflow export or production execution was changed by the repository update.

## 1. Add one shared HTTP Request node: Report Workflow Outcome

- POST to this expression:
  `{{ $('AccessPilot Config').first().json.backend_url.replace(/\/+$/, '') + '/service/jobs/' + $('Webhook').first().json.body.job_id + '/outcome' }}`
- Authorization header:
  `{{ 'Bearer ' + $('Webhook').first().json.body.source_service.credential }}`
- Send JSON body: `{{ { outcome: $json.outcome } }}`
- Timeout: 30000 ms. Keep errors visible; do not send secrets or raw model errors.

Accepted outcome values: `no_candidate_files`, `no_changes`, `validation_failed`,
`agent_failed`. The server derives all job/repository/user identity from the job.
An exact retry succeeds; conflicting outcomes return 409. Once GitHub remediation
starts, the endpoint rejects outcome reports so it cannot conceal partial writes.
The existing credential, expiry, owner session and GitHub authorization checks apply.

## 2. Handle a valid empty Agent 1 selection

In Normalize Candidates JavaScript, replace ONLY:

```javascript
if (!candidates.size) throw new Error('Agent 1 returned no candidate files. Check the audit/repository match.');
```

with:

```javascript
if (!candidates.size) return [{ json: { outcome: 'no_candidate_files' } }];
```

Add an IF node immediately after Normalize Candidates JavaScript:
Boolean expression `{{ typeof $json.path === 'string' && $json.path.length > 0 }}`
**is true**.

Move BOTH current outgoing connections (Get Source and Merge input 1) to its true
output. Connect its false output to Report Workflow Outcome. Valid candidate items
keep their original structure, so source retrieval and Prepare Repair Context work
unchanged. Malformed JSON and unauthorized paths must still fail validation; never
turn a parsing error into "no candidates".

## 3. Connect existing terminal reports

Replace No Changes Report's Code node body with:

```javascript
return [{ json: { outcome: 'no_changes' } }];
```

Replace Validation Failed Report's body with:

```javascript
return [{ json: { outcome: 'validation_failed' } }];
```

Connect both nodes to Report Workflow Outcome. Preserve the existing validated
changes path to Finalize Remediation Body and the remediation HTTP request.

## 4. Optional explicit agent/parser error reporting

For Agent 1, Agent 2 Attempt 0, Agent 2 Attempt 1 and candidate normalization,
set On Error to Continue (using error output). Connect ONLY their error outputs
to a new Code node containing:

```javascript
return [{ json: { outcome: 'agent_failed' } }];
```

Connect that node to Report Workflow Outcome. Do not feed an error item into the
normal source or remediation path. Do not enable retries or reconnect to an agent.
This reports ordinary node errors but cannot guarantee notification after a whole
workflow timeout, backend restart, expired credential or n8n outage. Those cases
remain a known limitation; durable job recovery is outside this demo-sized update.

## Verify

- Fresh scan with zero violations: complete, no n8n execution, no PR/spinner.
- Valid empty candidate array: manual-review message, findings remain visible.
- Valid no-change result: no draft PR claimed, polling stops.
- Validation failure: remediation failure with scan findings preserved.
- Existing successful remediation: confirmed draft PR and code preview unchanged.
- Never reuse pinned Webhook credentials after a backend redeploy.

The outcome describes workflow progress, not accessibility certification. No-change
results can still have unresolved findings. This endpoint accepts fixed reason codes
only; detailed model explanations are not currently copied into the dashboard.
