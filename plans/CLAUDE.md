# Agent guidelines for plans/

## Findings and plan steps are issues; run reports are files

Two things used to live in one `plans/<survey-name>-results.md` file, and they
are different shapes:

| | Shape | Where it lives |
|---|---|---|
| A survey's **findings**, and the **steps** a plan lays out | a **queue** — each one gets done and leaves | a GitHub issue |
| A run's **report** — coverage statement, category verdicts, summary table, the reasoning behind a plan | a **record** — nothing to close | a file in `plans/` |

An issue tracker is built for the first and is a bad container for the second.
Splitting them is what removed the bookkeeping: no renumbering, no deleting
entries by hand, no deciding whether a file has become an empty shell.

**Filing.** One issue per finding or step. Label every one — `survey:<name>`
for a survey's findings (`survey:health`, `survey:data-integrity`, …),
`plan:<name>` for a plan's steps (`plan:tooling`) — so a run or a plan is one
label query. Carry the survey's own finding fields into the body
(`plans/surveys/README.md` defines the shared six) and state the recommended
model tier in the first line, as the results files used to.
`.github/ISSUE_TEMPLATE/survey-finding.md` is the skeleton.

**Closing.** Put `Fixes #N` in the PR body and the issue closes on merge. Never
close a finding by editing a file. Dropping one as invalid or won't-fix is a
close with `not planned` **and a comment saying why** — the reason stays
visible, which is strictly better than the deletion it replaces.

**Deferring.** A finding that is real but deliberately not being fixed keeps its
issue open with a `deferred` label and a comment giving the reason. Three
vault-scaling findings had to be re-argued because a deferral was recorded in a
file that was later deleted; a labelled open issue cannot be lost that way.

**Dedup.** A survey re-derives its findings from scratch every run, so most of a
run's output is already open. Search the label before filing, and comment on the
existing issue with the new run's evidence rather than opening a second one.
This is the one step nothing enforces — it is a judgement call each run.

**The run report is not deleted.** The old rule — delete a results file once its
last finding closes — existed so no file would mix done with not-done work. A
run report contains no work at all: it is what was measured, what was
deliberately not looked at, and what the verdicts were. Nothing about it goes
stale when a finding closes, so it stays, at
`plans/<survey-name>-<YYYY-MM-DD>-run.md`, with its summary table pointing at
issue numbers. A plan file works the same way: it keeps the reasoning, and its
steps live as issues.

## Sizing PRs when writing a plan

When a plan (not a survey's findings) lays out the work that will implement it,
split it into PRs that are as large as possible without becoming mega-PRs, and
write each one with enough context that Sonnet 5 can carry out the
implementation from its issue alone. That "from the issue alone" bar is the
point — the issue is what the implementing session will read, and it will not
have this conversation's context.

## Citing a survey finding from code

**Cite the issue number.** It is globally unique, permanent, and survives every
re-run:

```ts
// data-integrity survey, #1042: a structural key in a shape the parser can't
// type has no `extra` home and is deleted on save.
```

Name the survey as well as the number — the number resolves on its own, but the
survey name is what tells a reader which rubric found it without a round trip.

**Legacy citations.** Before this convention, findings were numbered per run and
renumbered from #1 each time, so an old `finding #N` comment identifies nothing
on its own. The old rule still applies to those: **never renumber an existing
citation** — the old number is correct for the run it names. As of 2026-09-06
there were 70 such citations in `src/`, 20 of them naming neither a survey nor a
date. They are not mechanically fixable (the repo's history was squashed, so
`git blame` attributes them all to one commit) and guessing wrong is worse than
leaving them ambiguous. Qualify them opportunistically, when you touch the
surrounding code and know the answer.

## Open product questions

A change that turns out to hinge on a product decision goes in
`plans/open-product-questions.md`, not in a comment beside the code. A comment
is where such a question goes to be forgotten: the surveys that exist to
surface these (`product-niche.md` section 6, `data-integrity.md`'s
normalization-versus-corruption rule) read the plan files and run reports, not
inline prose.

This one stays a file rather than becoming issues, deliberately. It is read as
prose by whoever is deciding — a standing list of what the product hasn't
settled — not worked through as a queue, and it is short.
