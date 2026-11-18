# Triage Labels

Tier, `ready-for-agent`, `deferred`, `automerge` and the `## Decision needed`
section come from the workshop plugin's `workshop-conventions` skill; follow it. Only the
labels below are Meridian's own. Category labels such as `security` or `ux` are
for filtering and change nothing.

| Label | Means | Set by | What it does | Cleared by |
| --- | --- | --- | --- | --- |
| `survey` / `survey-finding` | A survey run's parent issue / one of its findings | The survey run | Counts open `survey-finding` issues; 3 or more and the survey task starts no new survey. The survey task closes a parent once all its findings are closed | Closing the issue |
