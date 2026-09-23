# Usability Survey

Evaluate the app **as a UI/UX expert would: by using it, without reading its
code.** The question is whether a person can do the jobs this product exists
for — quickly, confidently, without surprises — not whether the code behind
the screen is well made.

Shared process, scoring, and reporting rules live in [the shared survey
conventions](./README.md). Read that first; this file states only what's
specific to this survey, including the two shared fields it redefines
(Evidence and Breadth).

## Scope and boundaries

**In scope:** everything a user sees and does — task flows, navigation,
information architecture, the mental model the UI teaches, feedback and error
recovery, visual hierarchy, microcopy, consistency with itself and with
platform conventions, mobile and keyboard ergonomics, learnability.

**The other surveys own the same screens from other sides.** When a finding
belongs to one of them, hand it over in one line rather than reporting it here:

- `health-ui.md` — anything judged by *reading code*: whether a state is
  implemented, a11y markup, touch-target sizes, contrast (already a CI floor in
  `e2e/contrast-sweep.spec.ts`), styling-system consistency.
- `product-niche.md` — who the product is *for*. This survey takes the target
  user as given and asks whether they can succeed.
- `performance.md` — anything slow. Note perceived sluggishness here only as a
  pointer for that survey to measure.
- `data-integrity.md` — anything actually lost or corrupted.

A defect two surveys both find is one issue: search open issues first, per
[Reporting](./README.md#reporting), and comment rather than duplicate.

## Process

- **Code-blind until the findings are written.** Do not open `src/`, the
  README, `GLOSSARY.md`, commits or PRs before the walkthroughs and the
  heuristic sweep are done. Knowing what the code intends makes an evaluator
  forgive what a user cannot see — that forgiveness is the failure this survey
  exists to avoid. The only sources are the running app and what it shows,
  including the Tutorial vault's content as rendered. The root `CLAUDE.md` is
  loaded into every session regardless and names routes, slugs and features;
  say so in the coverage statement and don't use it to find a control.
- **Then locate, don't re-judge.** Once findings are written, you may grep for
  a finding's on-screen string or component to fill its Task context block, so
  the fixer gets a location. Do not revise a finding's verdict from what the
  code says it meant to do; a mismatch between intent and experience *is* the
  finding. The merged-PR history the shared conventions ask you to read belongs
  here too — after the pass, as a check on which defect classes the walkthroughs
  missed, feeding the survey-file diff.
- **Drive a real browser.** `pnpm exec vite --port <unique> --strictPort`, then
  a scratch script importing `chromium` from `@playwright/test` (`e2e/` is the
  worked example; pass `executablePath`, per `playwright.config.ts`'s
  `CHROMIUM_PATH` note). Mobile is primary: 390×844 with `hasTouch` and `isMobile`
  set; desktop at 1440×900. Within a task, move by tapping, never `page.goto`:
  a reload resets the Tutorial vault and every edit the task made. On every
  list card, try swipe in both directions and long-press — the 2026-09-23 run
  missed swipe-to-delete, the only delete with Undo, until the PR history
  named it. Use the default theme plus one dark theme — contrast
  across all themes is `health-ui.md`'s. Screenshot every step into the
  scratchpad; findings cite steps, not screenshots, since those cannot be
  attached to an issue. Environment limits are in [what this environment can and
  cannot do](./README.md#what-this-environment-can-and-cannot-do): only the
  Tutorial vault is reachable, so the add-vault flow is walked up to the
  browser-permission or OAuth hand-off, or the calendar's `Check calendar`
  (its server-side fetch fails here), and no further. Load the large vault
  (`meridian_bigvault`) once, to judge scanning and navigation at scale.
- **Walk each task, then sweep each screen.** For every task below, state the
  user's goal and what "done" looks like, then walk it cold as a first-time
  user and, at each step, answer the cognitive-walkthrough questions: would the
  user try to do this, would they notice the control, would they connect it to
  their goal, and would they see that it worked? Afterwards, sweep each distinct
  screen once against Nielsen's ten heuristics — this catches what no task
  happens to cross.
- **Say what this is not.** This is expert heuristic evaluation by a model, a
  proxy for user testing and a weak one. It cannot judge motion, gesture feel,
  haptics, or long-term habit, and it must not claim what users want. Write
  "a first-time user would likely…" as the hypothesis it is; where only real
  users could settle it, add it to the parent issue as a question for
  `product-niche.md`'s bet list rather than scoring it.

## Tasks to walk

Seed list, not the search space — add any job the app's own UI suggests is
core, and say which you added:

1. First run: work out what this app is and create a first entry.
2. Capture a task for tomorrow at 9:00.
3. Complete a task, then find it again.
4. Reschedule an event.
5. Change one occurrence of a recurring event; then change all future ones.
6. Write a note that links to another entry; follow the backlink.
7. Find an entry by searching.
8. Move between agenda, day, week, month, backlog and notes, and back to today.
9. Delete an entry, then undo it.
10. Change the theme and one other preference.
11. Start adding a vault (up to the environment's limit).

Budget: every task at mobile; tasks 1, 2 and 5 also at desktop; the heuristic
sweep once per distinct screen.

## Output structure

**Reporting:** per the [shared reporting conventions](./README.md#reporting),
with survey-type label `ux`, including suggested improvements to this survey
file itself.

### 1. Usability verdict (~5 sentences)

Name the **one or two tasks that go worst** and the **single biggest theme**
running through the findings.

### 2. Coverage statement

Which tasks were walked at which viewport, which were cut short and where, the
environment limits hit, and one line restating that this is heuristic
evaluation, not user testing.

### 3. Task results

One row per task × viewport: **completed** / **completed with friction** /
**failed**, the step count, and the finding numbers that explain it.

### 4. Category verdicts

One line per category (1–8), per the [shared
convention](./README.md#category-verdicts).

### 5. Findings — top 10

`Title`, `Recommended model`, `Problem` and `Fix` are the [shared finding
fields](./README.md#finding-fields). This survey redefines two and adds four:

- **Evidence** — replaces the file-and-quote rule: the reproduction steps from
  a named starting URL and viewport, plus the **verbatim on-screen text**
  involved (a label, a message, a button), grep-safe so the locate step and the
  spot-check can find it.
- **Breadth** — replaces the file count: the number of tasks from the list
  above (plus any you added) that hit the problem, named.
- **Category** — one or more tags from: `task-flow` `mental-model`
  `navigation` `feedback` `hierarchy` `consistency` `ergonomics`
  `learnability` `copy`
- **Heuristic** — the Nielsen heuristic or walkthrough question it breaks.
- **Impact** — 1–10 (10 = a core task cannot be completed, or the user loses
  work without noticing; 5 = a core task completes, but only after a detour or
  error most first-time users would hit; 1 = cosmetic).
- **Task context** — per [the shared rule](./README.md#write-findings-down-to-sonnet-5-where-you-honestly-can),
  filled in the locate step.

**Fails silently here** (what sets the tier): a fix that makes the reported
step right while a sibling flow diverges — the other edit scope, the other
viewport, the drawer on mobile versus the dialog on desktop — or a relabel in
one place that splits the product's vocabulary. Findings about the mental model
itself (what "a vault" or "all future occurrences" should mean) are usually
product decisions: tier them `opus-plan` and label `decision-required`. Example
hazard note: "Sonnet 5 if the three screens using this label are listed; else
Opus 5."

## Categories to walk — ranked by priority

1. **Task completion & efficiency** _(highest weight)_ — dead ends, detours,
   steps that could be skipped, defaults that make the common case slow.
2. **Mental model** — whether the UI teaches a model of entries, series,
   occurrences and vaults that predicts what the next action will do.
3. **Navigation & information architecture** — wayfinding, back behaviour,
   where things go after they are created, whether a view's purpose is clear
   from the view.
4. **Feedback, errors & recovery** — whether saving, syncing and failing are
   visible and understandable; undo and confirmation matched to how
   destructive an action is; error messages that say what to do next.
5. **Visual hierarchy & scannability** — whether the primary action and the
   important item on each screen are obvious, and whether a busy agenda scans.
6. **Consistency & platform conventions** — the same operation done the same
   way everywhere; behaviour that matches iOS, Android and desktop habits.
7. **Ergonomics** — thumb reach and one-handed use on mobile, the on-screen
   keyboard, keyboard efficiency on desktop.
8. **Learnability, discoverability & copy** — what first run teaches, hidden
   gestures, empty states, jargon (file-format or developer terms) that reaches
   the user.

**Scoring guidance:** a failure on a task a user does daily outranks a failure
on one done once; a problem hit on the default path outranks one behind a
setting. Say when a flow is right — a deliberate extra step that prevents a
costly mistake belongs in the category verdict as a keep, not in the findings.
