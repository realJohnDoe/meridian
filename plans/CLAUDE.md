# Agent guidelines for plans/

## State is an issue; documents are files

One rule decides where anything in `plans/` belongs:

| | Shape | Where it lives |
|---|---|---|
| A survey **run**, a survey **finding**, a plan **step**, a whole **plan**, an open **product decision** | **state** — it is open, then it is closed | a GitHub issue |
| A standing investigation or measurement report (a spike, a gap survey, a one-off study — not a run of `plans/surveys/*.md`) | a **document** — nothing to close; it gets *edited* | a file in `plans/reports/` |

Anything with an open/closed state is an issue; anything maintained as a
document is a file. That replaces every carve-out that used to be listed here,
and with it the bookkeeping: no renumbering, no deleting entries by hand, no
deciding whether a file has become an empty shell.

Two consequences, both of which used to be done by hand:

- **A plan is a parent issue with its steps as sub-issues**, and **a survey run
  is a parent issue with its findings as sub-issues** — the same shape. GitHub
  tracks the hierarchy and the progress; nothing needs a checklist in prose. The
  survey run's parent issue body carries what a report file used to (coverage
  statement, category verdicts, summary table), so a run produces no file at
  all. #1008 and #1065 are the worked examples.
- **A file that is part state, part document splits.** `ical-rrule-gaps.md` was
  a finished gap survey carrying two unfinished gaps: the survey became
  `plans/reports/ical-rrule.md`, the gaps became #1009 and #1010, and the report
  points at them. Still applies to `plans/reports/`; no longer applies to survey
  runs, which don't produce a file.

`plans/` therefore holds nothing but this file, the runnable surveys, and the
standing reports in `plans/reports/` (`storage-backend.md`, `vault-scaling.md`,
`ical-rrule.md`, and similar spikes). Everything with a state is in the tracker.

**Filing.** A survey run is one parent issue; each finding is a **sub-issue** of
it (GitHub's native relationship, not a label), labelled with:

- the survey's own `Category` tag(s), exactly as that survey's file defines them
  (`dry`, `srp`, `testing`, `security`, …);
- a **survey-type label** matching the parent — `health`, `ui`
  (`health-ui.md`), `performance`, `product` (`product-niche.md`),
  `data-integrity`;
- a **model-tier label** — exactly one of `haiku`, `sonnet`, `opus`,
  `opus-plan` — matching the Recommended model field;
- `decision-required` when the finding hinges on a product decision only the
  maintainer can make, in place of a separate issue.

There is no `survey:<name>` label — the survey-type label plus the category tags
replace it, so a run, a category or a tier is each one label query.
`plan:<name>` is unchanged for a plan and its steps (`plan:tooling`,
`plan:ical-rrule`). Carry the survey's own finding fields into the body
(`plans/surveys/README.md` defines the shared six) and state the recommended
model tier in the first line. `.github/ISSUE_TEMPLATE/survey-finding.md` is the
skeleton.

**Closing.** Put `Fixes #N` in the PR body and the issue closes on merge. Never
close a finding by editing a file. Dropping one as invalid or won't-fix is a
close with `not planned` **and a comment saying why** — the reason stays
visible, which is strictly better than the deletion it replaces.

**Deferring.** A finding that is real but deliberately not being fixed keeps its
issue open with a `deferred` label and a comment giving the reason. Three
vault-scaling findings had to be re-argued because a deferral was recorded in a
file that was later deleted; a labelled open issue cannot be lost that way.

**Dedup.** A survey re-derives its findings from scratch every run, so most of a
run's output is already open. Search open parent issues (and their sub-issues)
for the survey-type label before filing, and comment on the existing issue with
the new run's evidence rather than opening a second one. This is the one step
nothing enforces — a judgement call each run.

**The parent issue is not deleted.** The old rule — delete a results file once
its last finding closes — existed so no file would mix done with not-done work.
A parent issue contains no work of its own: it is what was measured, what was
deliberately not looked at, and what the verdicts were. It closes once every
sub-issue is resolved, so the record stays reachable from the tracker rather
than disappearing with the last finding.

## Sizing PRs when writing a plan

When a plan (not a survey's findings) lays out the work implementing it, split
it into PRs as large as possible without becoming mega-PRs, and write each with
enough context that Sonnet 5 can implement it **from its issue alone**. That bar
is the point: the issue is what the implementing session reads, and it will not
have this conversation's context.

## Citing a survey finding from code

**Cite the issue number.** It is globally unique, permanent, and survives every
re-run:

```ts
// data-integrity survey, #1042: a structural key in a shape the parser can't
// type has no `extra` home and is deleted on save.
```

Name the survey as well as the number — the number resolves on its own, but the
survey name tells a reader which rubric found it without a round trip.

**Legacy citations.** Before this convention, findings were numbered per run and
renumbered from #1 each time, so an old `finding #N` comment identifies nothing
on its own. **Never renumber an existing citation** — the old number is correct
for the run it names. As of 2026-09-06 there were 70 such citations in `src/`,
20 naming neither a survey nor a date.

They are, however, **mechanically resolvable** — this paragraph claimed
otherwise until 2026-09-13, on the grounds that the history "was squashed, so
`git blame` attributes them all to one commit". That is false: the history is
intact (3,225 commits back to 2026-05-22, merge commits throughout), and `git
blame` dates each citation to its run in one command —
`src/editor/save.ts:219`'s "finding #1" blames to 2026-09-05, the data-integrity
run. What made it *look* squashed is that a session's checkout is a **shallow
clone** (`git rev-parse --is-shallow-repository` tells you;
`git fetch --unshallow` fixes it). So qualifying them is cheap: do it when you
touch the surrounding code, or in one sweep. Guessing is still worse than
ambiguity, but you no longer have to guess.

## Open product questions

A change that turns out to hinge on a product decision becomes an issue labelled
`decision-required`, not a comment beside the code. A comment is where such a
question goes to be forgotten: the surveys that exist to surface these
(`product-niche.md` section 6, `data-integrity.md`'s
normalization-versus-corruption rule) read the tracker and the reports, not
inline prose. A survey finding hinging on the same kind of decision gets the
same label alongside its category and survey-type labels, rather than a separate
issue — see **Filing**.

Give it the evidence, why it matters, and the options as you see them — the
decision is the maintainer's, so the issue's job is to make deciding cheap.
Closing it means saying in the closing comment what was decided. #1011 is the
worked example.
