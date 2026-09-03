# Survey conventions

Shared process, scoring, and reporting rules used by every survey in this
directory (`health.md`, `performance.md`, `health-ui.md`,
`data-integrity.md`, `product-niche.md`). Each survey states only what's
specific to it — its categories, its findings cap, its target
invariants/flows/niches — and points back here for the rest.
`storage-backend.md` (now `plans/storage-backend.md`, one level up — it never
was a runnable survey template) and `vault-scaling.md` are finished research
reports, not runnable survey templates, so none of this applies to them.

Read this once before running (or editing) any survey.

## Recommended model tiers

Every finding is tagged with a **Recommended model** — the cheapest tier
capable of doing the fix well: **Haiku 4.5** / **Sonnet 5** / **Opus 5** /
**Opus 5 in plan mode, for a plan spanning multiple PRs** (or the current
equivalent tier, if these names have moved on).

Judge by how much of the fix is load-bearing judgment versus mechanical edit,
and by **how the fix fails**. A wrong-but-plausible change that breaks the
build, a type-check, or a test is far safer to hand down-tier than one that
fails silently — each survey below names what "fails silently" looks like in
its own domain. Reserve plan mode + multi-PR for findings that need an
architecture change **or** a product decision only the user should make.

**Always state the specific hazard that sets the tier** — the trap that would
void the fix, the invariant that fails quietly, the interacting call site
that's easy to miss. A tier without a named hazard is not useful. If naming
that hazard would let a lower tier do the job, say so explicitly (e.g.
"Sonnet 5 if the cache key is specified in the task; else Opus 5") — that
turns the field into a prompt-writing hint, not just a rating.

## Write findings down to Sonnet 5 where you honestly can

The tier is not a fixed property of a finding — it is a property of the
finding *as written*. Most Opus-tier ratings are really "Opus, because the
report withheld what the fixer would need". So for every finding, give it a
**Task context** block carrying the specifics that let the named tier work
without re-deriving them, and rate the tier against the finding *with* that
block. Aim to land as much of the report as possible at **Sonnet 5 or below**.

What belongs in a Task context block — whatever the finding actually needs,
but in practice:

- **Exact locations.** File plus line or line range for every site to change,
  and the list of call sites to update. Verify the numbers before writing them
  down; a confidently wrong line number is worse than none.
- **The enumerated work.** If the fix is "add the missing N things", list all
  N with the values they should take. If it is a move, say what moves and —
  just as important — **what stays**.
- **Measured numbers** the fixer would otherwise have to re-derive (coverage
  percentages for a new threshold, a dry-run's error count and distribution,
  a benchmark baseline). Say when they should be re-measured rather than
  trusted.
- **The trap, located.** Not "watch out for the animation" but "`Foo.tsx:57`
  branches on this prop being `undefined`, so a no-op is not equivalent".
  A hazard with a file and line is context; a hazard without one is a warning.
- **The precedent.** If the repo has already solved this shape somewhere,
  name the file and the commit — copying an in-repo pattern is far more
  reliable than inventing one.
- **The seam, verified in both directions.** For any extraction, state what
  the moved code depends on *and* what still depends on it, and say you
  checked. This is what turns "split this file" from a design task into an
  edit.

**Do not fake the downgrade.** Some findings are expensive because they need a
judgement call — a shared mutable singleton with no obvious owner, a product
decision about intended behaviour, an abstraction whose right shape isn't
determined by the code. Adding words does not make those Sonnet-able. When a
finding genuinely stays at Opus 5, say so *and say why the context doesn't
help*, so a reader can tell a real decision from a gap in the report. Where a
finding splits cleanly, split it: rate the specified half down and leave the
decision half where it belongs, rather than averaging the two into one
misleading tier.

Two knock-on effects to handle rather than ignore:

- **Re-rank after writing the blocks.** `effort` feeds the ranking formula, so
  moving a finding down a tier moves it up the order. Rank the final tiers,
  not the first-draft ones.
- **Keep finding numbers stable when the order changes.** The category
  verdicts reference finding numbers and results files get worked through as
  checklists, so treat `#N` as an identity and add a separate rank column
  rather than renumbering.

## Ranking findings

Rank by `(impact × breadth) ÷ effort`, where `effort` is the recommended-model
tier read as an ordinal — Haiku 4.5 = 1, Sonnet 5 = 2, Opus 5 = 3, Opus 5
plan-mode/multi-PR = 5 — but report impact, breadth, and recommended model as
separate fields rather than collapsing them into one number, so the reader
can re-sort by what they care about. Add a short **summary table** above the
findings (finding → recommended model, plus whichever other columns that
survey's findings carry) so the tiers can be read at a glance without
scrolling the full entries.

The tier rates **the fix**, not confirming it: re-running the build, lint, a
test suite, a measurement recipe, or a repro to verify a landed fix is fully
scripted and suits the cheapest tier regardless of which tier the fix itself
needed. Where findings touch the same code, add a one-line **sequencing
note** saying which order avoids rebasing the same file twice.

## Category verdicts

Every survey's output includes one line per category, using exactly one of
three verdicts:

- **clean** — the scan/trace/probe plan for this category was fully executed
  and nothing worth reporting turned up
- **findings: #N, #M** — pointing at the numbered findings below
- **partially assessed** — state what part of the plan was skipped and why

This makes the absence of findings distinguishable from the absence of
scanning. A category may only be called **clean** if its plan was actually
executed — never as a default for categories that ran out of budget.

## Don't pad the findings list

Every survey caps its findings at a stated top-N. Include everything that
makes the cut regardless of how low its score is — a trivial finding with
high breadth still earns its slot, and its low score speaks for itself. Do
not pad the list to reach N: a short report grounded in real evidence beats a
long one built on speculation.

## Reporting

**Write the findings to a file.** After a run, write its findings to
`../<survey-name>-results.md` — i.e. `plans/<survey-name>-results.md`, one
level up from this directory (e.g. `health.md` → `plans/health-results.md`)
— so they survive the session and can be worked from as a checklist. Once
every finding is fixed or explicitly dropped, delete the results file in the
same commit/PR that closes the last one out — see `git log -- plans/` for
the established pattern (results docs get added, then removed once
resolved). `data-integrity.md`'s "Known suspects" section, which appends a
verdict to each suspect's hypothesis in-place, is the exception: that survey
keeps its suspects list live in the survey file itself rather than a
separate results doc — follow whichever pattern the survey you're running
already uses.

Results files live directly in `plans/`; survey files themselves
(`health.md`, `performance.md`, etc.) stay in `plans/surveys/`.

**Suggest improvements to the survey itself, as a diff on the survey file.**
These survey files are themselves living specs, and a real run is evidence
about where they're unclear, stale, or wrong in a way a cold read never
surfaces — an ambiguous instruction, a budget item that turned out to be
unmeasurable, a category boundary that didn't hold, a scoring rule that
produced a counterintuitive order, a "known suspect" that's now stale. After
finishing a run, edit the survey `.md` file directly with the proposed
improvements, as its own commit separate from the results file and from any
fixes to the product itself — that way the suggestion shows up as an
ordinary reviewable diff in the PR (GitHub's review UI, comments,
approve/request-changes) instead of prose the user has to re-transcribe by
hand to apply it. Keep the edit scoped to genuine process learnings, not
findings that belong in the results file. Still propose rather than
silently commit past review: open it on the survey's own PR (or as a
`survey-run/<name>` branch if the results themselves aren't going through a
PR) so the user reviews and merges it like any other change, and note in the
results file, in one line, that the survey file was updated and why, so the
two stay linked.
