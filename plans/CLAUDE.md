# Agent guidelines for plans/

## State is an issue; documents are files

One rule decides where anything in `plans/` belongs:

| | Shape | Where it lives |
|---|---|---|
| A survey **finding**, a plan **step**, a whole **plan**, an open **product question** | **state** — it is open, then it is closed | a GitHub issue |
| A run **report**, a measurement, a finished survey | a **document** — nothing to close; it gets *edited* | a file in `plans/reports/` |

Anything with an open/closed state is an issue. Anything maintained as a
document is a file. That is the whole rule, and it replaces every carve-out
that used to be listed here.

Two consequences worth stating, because both used to be done by hand:

- **A plan is a parent issue with its steps as sub-issues.** GitHub tracks the
  hierarchy and the progress; nothing needs a checklist in prose. #1008 is the
  worked example.
- **A file that is part state, part document splits.** `ical-rrule-gaps.md` was
  a finished gap survey carrying two unfinished gaps: the survey became
  `plans/reports/ical-rrule.md`, the two gaps became #1009 and #1010, and the
  report points at them.

The bookkeeping this removed: no renumbering, no deleting entries by hand, no
deciding whether a file has become an empty shell.

**Filing.** One issue per finding, step, plan or question. Label every one —
`survey:<name>` for a survey's findings (`survey:health`,
`survey:data-integrity`, …), `plan:<name>` for a plan and its steps
(`plan:tooling`, `plan:ical-rrule`), `product-question` for a decision that is
the maintainer's to make and not an agent's — so a run, a plan, or the open
questions is one label query. Carry the survey's own finding fields into the body
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
stale when a finding closes, so it stays.

Reports live in **`plans/reports/`**, beside `plans/surveys/` — a run's report
at `plans/reports/<survey-name>-<YYYY-MM-DD>.md`, with its summary table
pointing at issue numbers, alongside the standing ones (`storage-backend.md`,
`vault-scaling.md`, `ical-rrule.md`). `plans/` itself then holds nothing but
this file and those two directories: the runnable surveys, and the documents
they produced. Everything with a state is in the tracker.

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

A change that turns out to hinge on a product decision becomes an issue
labelled `product-question`, not a comment beside the code. A comment is where
such a question goes to be forgotten: the surveys that exist to surface these
(`product-niche.md` section 6, `data-integrity.md`'s
normalization-versus-corruption rule) read the tracker and the reports, not
inline prose.

Give it the evidence, why it matters, and the options as you see them — the
decision is the maintainer's, so the issue's job is to make deciding cheap.
Closing it means saying in the closing comment what was decided. #1011 is the
worked example.
