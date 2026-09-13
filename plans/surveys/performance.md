# PWA Snappiness Survey

Survey this codebase for UI performance issues. The goal: the app should feel **instantly responsive** in everyday use. Find the **top 5 performance issues** affecting the most common user flows, each with a **measured baseline** so proposed fixes can be verified by re-measurement.

Shared process, scoring, and reporting rules — model-tier ratings, the ranking
formula, and how to report results — live in [the shared survey
conventions](./README.md). Read that first; this file states only what's
specific to this survey.

## Target user flows (the hot paths)

Findings must be anchored to one or more of these — an issue no common flow ever hits scores near zero regardless of how wasteful the code looks:

1. **Toggling a task** — in agenda view and in the entry editor (click → visual feedback → persisted)
2. **Switching views** — day ↔ month ↔ agenda, and navigating between dates
3. **Searching** — opening the search bar, typing, waiting for results, then clicking one or creating a new entry from it
4. **Creating a new item** — opening the entry editor, typing, saving
5. **Changing metadata** — dates, scopes, titles, repeat rules on an existing entry
6. **Cold start / reload** — time until the calendar is interactive (PWA launch, first paint, vault load)
7. **Typing in the editor** — keystroke-to-paint latency in CodeMirror, including wikilink/decoration updates

## Process

**Trace, then measure, then write** — three phases, in order. (1) Name each flow's entry point and the modules you expect it to traverse, then trace it end to end through the real code: handler → state update → subscriptions notified → components re-rendered → persistence. (2) Measure against realistic data, capturing numbers *before* forming conclusions. (3) Only then write the findings.

- **Every finding needs a baseline number and a recipe.** A finding without a measurement is at most an "unverified" note in the coverage statement. The **recipe** is the acceptance test for the fix — the instrumentation snippet, where it was patched in, the interaction performed, how the number was read out — precise enough that a later session reruns it unchanged. Instrumentation is temporary: patch it in, measure, revert.
- **Measure amplification, not vibes.** "Missing `memo`" is not a finding. A finding shows amplification with a number attached: this click re-renders N components (counted), this handler runs X ms before paint (measured), this module adds Y kB to the entry chunk (build output).
- **React Compiler is enabled** (`vite.config.ts` applies `reactCompilerPreset`), so components and hooks are auto-memoized at build time. Static "missing `memo`" and "unstable props defeat memoization" reasoning **does not transfer to this codebase** — those need runtime render counts or they are not findings. This rule outranks any category bullet below that reads like it contradicts it.
- **Perceived performance counts.** A toggle that persists in 300 ms but paints optimistically in 16 ms is *fast*; one that paints after persistence is *slow* at identical total work. Measure when pixels change, not just how much work runs.
- **Dev-mode numbers are relative, not absolute.** Unminified dev React overstates ms costs, so treat dev measurements as before/after baselines rather than latency claims. Measure flow 6 and all bundle findings against the production build (`pnpm run build` + `vite preview`); the big-vault generator is dev-only, so accept the small example vault there and say so.
- **Only the example (Tutorial) backend is measurable** — see [what this environment can and cannot do](./README.md#what-this-environment-can-and-cannot-do). Record the other two as "traced, not measured".

## Budget

- **Use the existing harnesses — do not write your own.** Two exist, and both cost real work to get right:
  - **The big-vault generator** ([recipe](./README.md#what-this-environment-can-and-cannot-do)). The example vault is too small to expose scaling problems; note the size you used.
  - **`scripts/perf/`** (`stress.mjs`, `probe.mjs`, `table.mjs`, plus its own README) already measures task toggle (flow 1), cold start (flow 6) and agenda scroll, as well as the parse/derive pipeline stage by stage and the Dexie path, from 300 to 30 000 files, with a fresh browser context per size. Read `scripts/perf/README.md` before writing your first `performance.mark`; hand-instrument only flows 3, 4, 5 and 7, and say which numbers came from the harness and which you patched in. Its own caveats: nothing in CI runs it, so a result is one machine at one moment (the kept numbers live in [vault-scaling.md](../reports/vault-scaling.md)), and it drives the dev server, so read the curve rather than the milliseconds.
- **A missing `preview_*` tool is not a reason to skip phase 2.** `stress.mjs` launches Chromium itself via `@playwright/test` and needs no preview tooling, which also makes it the fallback; `e2e/` is the worked example for driving your own (`pnpm exec vite --port <unique> --strictPort`, then `import { chromium } from '@playwright/test'`). With preview tools, follow the gotchas in `CLAUDE.md`. If neither is available, say so, mark the flows **traced, not measured**, and flag every finding resting on an unmade measurement.
- Read closely: the store (`store.ts`, `storeBridge.ts`) and every subscription pattern it exposes; the components rendered per occurrence/row in agenda view (these multiply — a small waste per row is a big waste per screen); the toggle/save/commit path (`occurrenceActions.ts`, `storeCommit.ts`, `persistencePort.ts`); `search/` end to end from keystroke to result click; the editor's update/decoration path; what each route mounts.
- Read the build and loading story, not just the source: the Vite config, route-level lazy loading or its absence, the service worker / PWA caching setup, and heavyweight imports reachable from the entry point. Rank the emitted chunks by size.
- **Check where persistence runs relative to paint:** for each mutating flow, whether YAML serialization, IndexedDB writes and sync happen before or after the UI updates, and whether they run synchronously with the interaction.
- Skim the tree so nothing is invisible; record anything skipped.

## Output structure

**Reporting:** per the [shared reporting conventions](./README.md#reporting), including suggested improvements to this survey file itself.

1. **Snappiness verdict** (~5 sentences) — where does the app do unnecessary or badly-timed work? Name the worst one or two flows with their headline numbers, and the single biggest structural theme (e.g. "every mutation re-renders the whole visible agenda because subscriptions are file-granular, not occurrence-granular").
2. **Coverage statement** — which flows you traced *and* measured end to end, which you only traced, which you skipped and why; the test vault (size, how generated); anything you suspect but lacked budget to measure, flagged "unverified".
3. **Category verdicts** — one line per category, per the [shared convention](./README.md#category-verdicts).
4. **Findings — top 5.**

Findings carry the [shared fields](./README.md#finding-fields), with `Breadth` optionally counted in components-per-screen where the multiplication is the point, and `Fix` stating the **expected effect on the baseline** ("render count per toggle should drop from ~180 to ~2"). This survey adds:

- **Flows affected** — which numbered flows, and how often a user hits them (every keystroke / every toggle / every view switch / once per launch)
- **Category** — `render-amplification` `critical-path-work` `perceived-latency` `bundle-and-startup` `data-and-persistence` `search-latency` `editor-latency` `memory-and-leak`
- **Impact** — 1–10, = perceived cost per occurrence × flow frequency (10 = visible jank on an every-interaction path; 5 = a noticeable delay on a daily action; 1 = measurable but imperceptible)
- **Baseline measurement** — the numbers, with their conditions (vault size, view, interaction)
- **Measurement recipe** — re-runnable, per the Process rule above

**Fails silently here:** stale state, wrong ordering, misplaced pixels, or a bundle change that doesn't actually move the number. Reserve plan mode + multi-PR for an architecture change **or** a product decision ("cap the list" vs "restructure the virtualizer"). Hazard note example: "Sonnet 5 if the cache key is specified in the task; else Opus 5." "Confirming" a fix means re-running the measurement recipe.

---

## Categories to scan — ranked by priority

Bullets are illustrations, not your search space — see [Running a survey](./README.md#running-a-survey). Everything here is subordinate to the React Compiler rule in Process.

### 1. Render amplification _(highest weight)_

**Scope:** one state change causing more re-renders than the pixels that changed.

The shapes that actually occur here: store subscriptions selecting broad slices (whole file map, whole occurrence list), so every mutation re-renders every subscriber; occurrence expansion, sorting or filtering recomputed per render rather than per input change; and a parent re-render fanning out across occurrence rows or day cells. All three need counted renders to be findings — fine-grained `useMemo` inside a leaf is out of scope either way.

### 2. Critical-path work & perceived latency

**Scope:** work between an interaction and its paint, or UI waiting for work it needn't.

- Mutations that serialize YAML / write IndexedDB / trigger sync *before* the UI reflects the change, instead of optimistic update + async persist
- Synchronous heavy computation (occurrence expansion, repeat-rule evaluation, search indexing) inside handlers or render with no `startTransition`, idle callback or worker
- Layout thrash, and missing debounce on typing/scroll/resize that recomputes per event

### 3. Search latency

**Scope:** keystroke-to-results, and the cost of acting on a result.

- Full scan over all files/occurrences per keystroke with no index, debounce, or incremental narrowing of the previous result set
- Index built lazily on first search (first-keystroke stall) or rebuilt wholesale on every vault mutation
- Result click or create-new-from-search doing avoidable synchronous work before navigation paints

### 4. View switching & navigation cost

**Scope:** the cost of moving between views and dates.

- Views that unmount/remount and recompute everything on a switch where the data didn't change
- Expensive per-view derivations (expanded occurrences, month grids) not reused across navigation
- Effects re-running on navigation due to unstable dependencies

### 5. Bundle size & startup

**Scope:** launch to interactive, and what the initial bundle pays for.

- Missing route/feature-level splitting — the editor, debug tooling or rarely-used dialogs sitting in the entry chunk. **Verify against build output, not imports:** one static import of a barrel elsewhere silently defeats a `React.lazy`, and every file involved reads correctly on its own. Grep the largest chunk for dependency markers (`cm-content`, `rdp-`, `Dexie`, `embla`) to establish where each landed, then measure the fix by rebuilding and diffing the chunk.
- Vault/data loading blocking first paint where a cached shell + progressive load would do
- Eager startup work (parsing all files, building indexes) that could be lazy or incremental

### 6. Data & persistence efficiency

**Scope:** the volume and frequency of parse/serialize/storage work.

- Whole-vault or whole-file reprocessing where one entry changed
- Per-item IndexedDB transactions in a loop instead of batched; reads on the render path
- Sync triggered more often than needed, or not coalesced across rapid successive edits
- Redundant model → YAML → model round-trips inside one flow

### 7. Editor keystroke latency

**Scope:** per-keystroke cost in CodeMirror.

- Decorations recomputed over the whole document per keystroke instead of the viewport or changed range
- Store or React state updated per keystroke, dragging the React tree into every keypress

### 8. Memory & degradation over time

**Scope:** performance that decays with session length or vault size.

- Subscriptions/observers never cleaned up in effect teardown; unbounded caches or history retention
- Scaling cliffs: O(n²) over files/occurrences that feel fine on the example vault — state the n at which it hurts. `scripts/perf/` exists to find exactly these; use it rather than reasoning about them.

---

**Scoring guidance:** An every-interaction path (typing, toggling, searching) outranks an equal-sized finding on a once-per-session path — but a startup finding measured in whole seconds still beats a 5 ms toggle finding. A structural fix that mechanically speeds up *all* flows (subscription granularity, the shared commit path's optimistic update) scores like the class it fixes, not one callsite. Skip micro-optimizations invisible at 60 fps.
