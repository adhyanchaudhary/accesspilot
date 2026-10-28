# Friendly accessibility rules

`axe-rules.json` maps exact axe rule IDs to plain-language titles, explanations,
and suggested approaches. It currently covers common rules, not every axe rule.
Add entries using the existing `title`, `why`, and `suggestion` fields. Unknown
rules fall back to the original finding, without inventing a specific fix.

The findings list keeps the original technical description and element evidence.
The code viewer looks up only the selected changed file's `issue_ids` from the
existing authenticated changes API. These associations describe intended fixes;
they are not proof that a new scan has passed. The actual diff remains the source
of truth for what was edited.

No n8n changes, MongoDB queries, or additional AI requests are required. Updating
this bundled JSON requires rebuilding the frontend.
