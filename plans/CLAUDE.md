# Agent guidelines for plans/

## State is an issue; documents are files

One rule decides where anything in `plans/` belongs:

| | Shape | Where it lives |
|---|---|---|
| A survey **run**, a survey **finding**, a plan **step**, a whole **plan**, an open **product decision** | **state** — it is open, then it is closed | a GitHub issue |
| A standing investigation or measurement report (a spike, a gap survey, a one-off study — not a run of `plans/surveys/*.md`) | a **document** — nothing to close; it gets *edited* | a file in `plans/reports/` |

Anything with an open/closed state is an issue. Anything maintained as a
document is a file. That is the whole rule, and it replaces every carve-out
that used to be listed here.

Three consequences worth stating, because all three used to be done by hand:

- **A plan is a parent issue with its steps as sub-issues.** GitHub tracks the
  hierarchy and the progress; nothing needs a checklist in prose. #1008 is the
  worked example.
- **A survey run is a parent issue with its findings as sub-issues** — the
  same shape as a plan. The parent issue's body carries what a `plans/reports/`
  file used to (the coverage statement, the category verdicts, the summary
  table), so a survey run no longer produces a separate report file; the issue
  itself is the record, and it stays open until every finding sub-issue is
  resolved. #1065 is the worked example.
- **A file that is part state, part document splits.** `ical-rrule-gaps.md` was
  a finished gap survey carrying two unfinished gaps: the survey became
  `plans/reports/ical-rrule.md`, the two gaps became #1009 and #1010, and the
  report points at them. This still applies to the standing investigation
  reports in `plans/reports/`; it no longer applies to survey runs, which
  don't produce a file at all now.

The bookkeeping this removed: no renumbering, no deleting entries by hand, no
deciding whether a file has become an empty shell.

**Filing.** A survey run is one parent issue; each finding is filed as a
**sub-issue** of it (GitHub's native sub-issue relationship, not a label),
labelled with:

- the survey's own `Category` tag(s), exactly as that survey's file already
  defines them (`dry`, `srp`, `testing`, `security`, …);
- a **survey-type label** matching the parent issue — `health`, `ui`
  (`health-ui.md`), `performance`, `product` (`product-niche.md`),
  `data-integrity`;
- a **model-tier label** — exactly one of `haiku`, `sonnet`, `opus`,
  `opus-plan` — matching the Recommended model field;
- `decision-required` when the finding hinges on a product decision only the
  maintainer can make, in place of a separate issue.

There is no more `survey:<name>` label — the survey-type label plus the
category tags replace it, so a run, a category, or a tier is each one label
query. `plan:<name>` is unchanged for a plan and its steps (`plan:tooling`,
`plan:ical-rrule`). An open product decision that isn't itself a survey
finding is still its own issue, labelled `decision-required` (this used to be
`product-question` — same shape, renamed for consistency with the finding
label of the same name). Carry the survey's own finding fields into the body
(`plans/surveys/README.md` defines the shared six) and state the recommended
model tier in the first line, as the report files used to.
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
run's output is already open. Search open parent issues (and their sub-issues)
for the survey-type label before filing, and comment on the existing issue
with the new run's evidence rather than opening a second one. This is the one
step nothing enforces — it is a judgement call each run.

**The parent issue is not deleted.** The old rule — delete a results file once
its last finding closes — existed so no file would mix done with not-done
work. A survey run's parent issue contains no work of its own: it is what was
measured, what was deliberately not looked at, and what the verdicts were,
same as the report file it replaces. It closes (rather than being deleted)
once every finding sub-issue is resolved, so the record — including the
coverage statement and what was deliberately not filed — stays reachable from
the issue tracker rather than disappearing with the last finding.

Standing investigation reports (not survey runs) still live in
**`plans/reports/`**, beside `plans/surveys/` — `storage-backend.md`,
`vault-scaling.md`, `ical-rrule.md`, and similar one-off spikes and measurement
studies. `plans/` itself then holds nothing but this file and those two
directories: the runnable surveys, and the standing documents that aren't
themselves survey runs. Everything with a state — including every survey
run — is in the tracker.

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
labelled `decision-required`, not a comment beside the code. A comment is where
such a question goes to be forgotten: the surveys that exist to surface these
(`product-niche.md` section 6, `data-integrity.md`'s
normalization-versus-corruption rule) read the tracker and the reports, not
inline prose. A survey finding that hinges on the same kind of decision gets
the same label alongside its category and survey-type labels, rather than a
separate issue — see **Filing** above.

Give it the evidence, why it matters, and the options as you see them — the
decision is the maintainer's, so the issue's job is to make deciding cheap.
Closing it means saying in the closing comment what was decided. #1011 is the
worked example.
