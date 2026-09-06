# Survey conventions

Shared process, scoring, and reporting rules used by every survey in this
directory (`health.md`, `performance.md`, `health-ui.md`,
`data-integrity.md`, `product-niche.md`). Each survey states only what's
specific to it — its categories, its findings cap, its target
invariants/flows/niches — and points back here for the rest.
Finished research reports live one level up in `plans/` rather than here, so
everything in this directory is a runnable survey and none of it needs an
exception: `plans/storage-backend.md` and `plans/vault-scaling.md` are both
that kind of report.

Read this once before running (or editing) any survey.

## Running a survey

These four rules held identically in every survey and are stated once here.

- **Survey first, write second.** State your plan before you start — scan
  plan, trace plan, threat plan, or Phase 0, whichever the survey calls for —
  complete it, and only then write the report. For each category say what
  you'll look for *beyond* the listed examples: the bullets are illustrations,
  not your search space. Do not draft the verdict early and select findings to
  confirm it.
- **Evaluate the code on its merits.** Treat claims in `CLAUDE.md`, `AGENTS.md`
  files, READMEs and code comments — "this exception is deliberate", "this is
  debounced", "a refactor is planned", "round-trips back to the same store
  state" — as hypotheses to verify, not settled exceptions. A documented
  rationale that no longer holds is itself a finding, and so is an invariant
  asserted in a doc but neither enforced nor tested.
- **Verify capability claims by inspection, not memory.** Check the *installed*
  version of a plugin or library — its actual rule set, exports, component
  inventory or API — against what the config enables; never infer it from a
  version number, and never let "latest" come from training data instead of a
  registry query. Where cheap, verify by dry-run: run the tool with the
  candidate config and report the real count and distribution. Clean up temp
  files and instrumentation afterwards; leave the working tree clean.
- **The category ranking is a tiebreaker, not a filter.** A serious finding in
  any category outranks a minor finding in a higher-priority one. Never omit a
  high-impact issue because its category ranks lower.

### What this environment can and cannot do

Three constraints bit more than one run mid-pass. Record them in the coverage
statement up front rather than discovering them:

- **Generate the gitignored types before trusting lint.** On a fresh worktree,
  `pnpm install`, then `pnpm run build` (for `src/routeTree.gen.ts`) and
  `pnpm --filter meridian-oauth-worker run cf-typegen` (for the worker types).
  Without them the type-aware rules flood with ~150 spurious errors that are
  **not** a finding. See `CLAUDE.md`'s linting section.
- **Only the example (Tutorial) backend is reachable.** The automated browser
  cannot grant File System Access permissions or complete the GitHub OAuth
  flow, so the local-FS and GitHub backends can only be traced statically or
  through their unit tests. Say so up front, not mid-pass.
- **A large vault already exists — do not write a generator.** Deterministic,
  at `src/storage/devFixtures/testVaultGen.ts`: run
  `localStorage.setItem('meridian_bigvault', '300')` in the console, then
  reload the Tutorial vault, and note the size you passed in the coverage
  statement. It is dev-only (`import.meta.env.DEV`) and absent from production
  builds, so it cannot be used against a prod build.

`CLAUDE.md`'s "don't proactively drive the dev server" rule does not apply to
a survey run — the surveys that require a measurement or screenshot pass say
so explicitly, and that pass is the ask.

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

## Finding fields

Six fields are the same in every survey and are defined once here. Each survey
adds its own — its `Category` tag list, its `Impact` scale, and whatever its
domain needs (`Baseline measurement`, `Repro`, `Invariant violated`, `Gap`, …)
— and states only those.

- **Title** — short label.
- **Breadth** — the number of **files** affected. Counts must come from an
  actual search (grep/glob) and you should be able to name the search you ran;
  if you estimated instead, write "est." next to the number. Where the exposure
  is a *condition* rather than a file set ("every entry, whenever two tabs are
  open"), say that instead of forcing a file count — but still name the search
  that established it, including a grep that returned **zero** hits where
  absence is the point.
- **Recommended model** — tier per the [rubric above](#recommended-model-tiers),
  rated against the finding *with* its Task context block present. **How the
  fix fails is the tell:** a wrong-but-plausible change that breaks the build, a
  type-check or a test is far safer to hand down-tier than one that fails
  silently. Each survey names what "fails silently" looks like in its domain and
  gives an example hazard note. Reserve plan mode + multi-PR for findings that
  need an architecture change **or** a product decision only the user should
  make.
- **Evidence** — at least one file path plus a short **verbatim quote** from
  that file (line number optional). Copy-pasted, not paraphrased — this gets
  spot-checked by grepping, so quotes must be grep-safe: quote a span that lives
  on one line, or say so and give the line range where the source is hard-wrapped
  prose. A quote that silently spans a line break reads as fabricated when the
  spot-check fails. For toolchain findings a config quote plus a dry-run result
  is evidence.
- **Problem** — one sentence: what is wrong and why it matters.
- **Fix** — one sentence: what the concrete change is. Where the survey
  measures something (a baseline, a repro), also say how that measurement
  should read afterwards.

**Prefer systemic and structural findings over isolated, line-level ones.** A
pattern across 10 files beats one misused function. Cite real code — no generic
observations.

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
