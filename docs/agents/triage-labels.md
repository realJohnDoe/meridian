# Triage Labels

The labels the workshop (`docs/agents/daily-dispatch.md`, the survey task) acts on.
Only these drive it; category labels such as `security` or `ux` are for
filtering and change nothing. Add a label here before the workshop starts acting
on it.

## Issue labels

| Label | Means | Set by | What the workshop does | Cleared by |
| --- | --- | --- | --- | --- |
| `haiku` / `sonnet` / `opus` | The cheapest model tier that can do the fix well (exactly one) | Whoever files the issue | Dispatches it to a session on that model once unblocked; the session labels a `haiku`/`sonnet` PR `automerge`, an `opus` one waits for review | Changing tier = swapping the label |
| `opus-plan` | A plan spanning several PRs | Whoever files the issue | Never dispatched; listed under **Not picked up** for a plan session started by hand | Splitting it into tier-labelled sub-issues |
| `decision-required` | A human must decide before work starts | Whoever files the issue | Not dispatched; listed under **Decide** in the digest once nothing blocks it | The maintainer, once decided (replies on the digest are copied over and remove it) |
| `deferred` | Parked on purpose; not now, not dropped | The maintainer, a survey run, or a workshop pause (on PRs) | Not dispatched; listed under **Not picked up**; doesn't hold a survey's next run | Removing it re-queues the issue |

Order between issues is not a label: it is a native blocked-by edge (**Blocking** in `docs/agents/issue-tracker.md`).

## PR labels

`automerge`: the only merge condition. Whoever opens the PR sets it (a dispatched session for a `haiku`/`sonnet` issue, a survey run for its learnings PR, anyone else deliberately); a green, quiet PR with it is merged, any other non-draft PR waits in the digest's Review list. A draft PR is outside the workshop (`docs/agents/daily-dispatch.md`, **Auto-merge**).

## Mapping to mattpocock/skills triage roles

| Role in mattpocock/skills | In our tracker |
| --- | --- |
| `needs-triage` | an issue with no tier label |
| `needs-info` | `decision-required` |
| `ready-for-agent` | a tier label and no `decision-required` or `deferred` |
| `ready-for-human` | `decision-required` |
| `wontfix` | close as `not planned` (no label) |
