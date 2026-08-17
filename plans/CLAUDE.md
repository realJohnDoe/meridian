# Agent guidelines for plans/

## Keep survey results in sync with fixes

`plans/<survey-name>-results.md` files (see `plans/surveys/README.md`) are
checklists, not historical records. If you work on a PR that fixes one or
more findings from a results file — even if it's not a full survey run, just
picking off a finding or two — remove those findings' entries from the
results file as part of that same PR.

- Remove only the entries the PR actually fixes (or explicitly drops as
  invalid/won't-fix, noting why in the commit message). Leave the rest of the
  file — other findings, the summary table row for each, coverage statement,
  category verdicts — untouched other than deleting the closed-out rows/
  sections.
- If a results file's findings are all resolved this way, delete the file
  entirely in the same commit, per `plans/surveys/README.md`.
- This applies to `plans/*.md` implementation plans too: once a plan (or a
  numbered step/section within one) has been implemented, remove that
  content from the plan file in the PR that implements it, rather than
  leaving it to go stale alongside the shipped code.

The goal is that anyone reading a results or plan file sees only
still-outstanding work — never a mix of done and not-done that requires
cross-referencing git history to tell apart.
