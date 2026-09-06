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
- **If the finding(s) removed were the last ones still open in that results
  file, delete the file entirely** in the same commit — don't leave behind an
  empty shell of headers and a summary table with no rows. This is not a
  separate cleanup step to do later; check it every time you remove a
  finding, per `plans/surveys/README.md`.
- This applies to `plans/*.md` implementation plans too: once a plan (or a
  numbered step/section within one) has been implemented, remove that
  content from the plan file in the PR that implements it, rather than
  leaving it to go stale alongside the shipped code.

The goal is that anyone reading a results or plan file sees only
still-outstanding work — never a mix of done and not-done that requires
cross-referencing git history to tell apart.

## Sizing PRs when writing a plan

When a plan (not a survey's findings) lays out the PRs that will implement
it, split the work into PRs that are as large as possible without becoming
mega-PRs, and write each one with enough context that Sonnet 5 can carry
out the implementation from that PR's description alone.

## Citing a survey finding from code

A `finding #N` comment in `src/` outlives the report it points at: results
files are deleted once their findings close (above), and every survey
renumbers from #1 on each run. So the number alone identifies nothing.

**Name the survey and the run date whenever you write one:**

```ts
// data-integrity survey 2026-09-05, finding #4: a structural key in a shape
// the parser can't type has no `extra` home and is deleted on save.
```

Never renumber existing citations to match a newer run — `data-integrity.md`
says why, and the old numbers are still correct for the run they name. The
convention applies going forward.

As of 2026-09-06 there are 70 such citations in `src/` and 20 of them name
neither a survey nor a date. They are not mechanically fixable — the repo's
history was squashed, so `git blame` attributes them all to one commit — and
guessing wrong is worse than leaving them ambiguous. Qualify them
opportunistically, when you touch the surrounding code and know the answer.

## Open product questions

A change that turns out to hinge on a product decision goes in
`plans/open-product-questions.md`, not in a comment beside the code. A comment
is where such a question goes to be forgotten: the surveys that exist to
surface these (`product-niche.md` section 6, `data-integrity.md`'s
normalization-versus-corruption rule) read plans and results files, not
inline prose.
