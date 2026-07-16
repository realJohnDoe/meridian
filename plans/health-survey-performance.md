# PWA Snappiness Survey

Survey this codebase for UI performance issues. The goal: the app should feel **instantly responsive** in everyday use. Find the **top 5 performance issues** affecting the most common user flows, each with a **measured baseline** so proposed fixes can be verified by re-measurement.

## Target user flows (the hot paths)

Findings must be anchored to one or more of these flows — an issue that no common flow ever hits scores near zero regardless of how wasteful the code looks:

1. **Toggling a task** — in agenda view and in the entry editor (checkbox click → visual feedback → persisted)
2. **Switching views** — day ↔ month ↔ agenda, and navigating between dates
3. **Searching** — opening the search bar, typing a query, waiting for results to appear, then either clicking a result or creating a new entry from the search
4. **Creating a new item** — opening the entry editor, typing, saving
5. **Changing metadata** — editing dates, scopes, titles, repeat rules on an existing entry
6. **Cold start / reload** — time until the calendar is interactive (PWA launch, first paint, vault load)
7. **Typing in the editor** — keystroke-to-paint latency in CodeMirror, including wikilink/decoration updates

## Process

- **Trace first, then measure, then write.** Three phases, in order:
  1. **Trace plan.** For each flow above, name the entry point (event handler / route / effect) and the modules you expect it to traverse. Trace each flow end to end through the actual code — handler → state update → subscriptions notified → components re-rendered → persistence work.
  2. **Measurement pass.** Run the app (dev server + browser tools) and measure each flow against realistic data (see Budget for the test-vault requirement). Capture numbers _before_ forming conclusions.
  3. **Report.** Only after both passes, write the findings. Do not draft the verdict early and select measurements to confirm it.
- **Every finding needs a baseline number and a recipe.** A finding without a measurement is at most an "unverified" note in the coverage statement. For each finding, record:
  - **Baseline:** the measured cost (ms of handler time, render count, chunk kB, time-to-interactive) on the test vault.
  - **Measurement recipe:** the exact, re-runnable steps that produced the number — the instrumentation snippet (`performance.mark`/`performance.measure` pairs, a render counter, `why-did-you-render`-style logging), where it was patched in, the interaction performed, and how the number was read out. This recipe is the acceptance test for the fix: after the fix, rerun it and compare.
  - Instrumentation is temporary — patch it in, measure, and revert; do not leave measurement code in the working tree.
- **How to measure in this environment:** start the dev server via the preview tools (follow the preview gotchas in CLAUDE.md — worktree-specific launch config, unique port, SPA-navigate instead of hard-navigating to `?editor=`), drive the flows via the browser tools, and read numbers via `javascript_tool` (e.g. `performance.getEntriesByType('measure')`, patched-in counters on `window`). For render counts, a module-level counter incremented in the component body and read from the console is fine. For bundle findings, `pnpm run build` output is the measurement.
- **React Compiler is enabled** (`vite.config.ts` applies `reactCompilerPreset`; components and hooks are auto-memoized at build time). Static "missing `memo`" / "unstable props defeat memoization" reasoning does not transfer to this codebase — memoization findings must be backed by runtime render counts, never by code inspection alone.
- **Dev-mode numbers are relative, not absolute.** The dev server runs unminified dev-mode React, which overstates ms costs. Treat dev-server measurements as baselines for before/after comparison, not as absolute latency claims. Measure flow 6 (cold start, first paint, service-worker behavior) and all bundle findings against the production build (`pnpm run build` + `vite preview`) — and since the big-vault generator is dev-only, accept the small example vault for prod-build measurements and state that limitation in the coverage statement.
- **Only the example (Tutorial) backend is measurable in this environment.** The automated browser cannot grant File System Access permissions or complete the GitHub OAuth flow, so the local-FS and GitHub backends can only be traced statically — record them as "traced, not measured" in the coverage statement up front rather than discovering this mid-pass.
- **Measure amplification, not vibes.** "Missing `memo`" is not a finding by itself. A finding must show _amplification with a number attached_: this click re-renders N components (counted), this handler runs X ms of synchronous work before paint (measured), this module adds Y kB to the entry chunk (from build output). Count subscribers via grep where relevant, but the headline evidence is runtime measurement.
- **Perceived performance counts as performance.** A toggle that persists in 300 ms but paints the checkmark optimistically in 16 ms is _fast_; one that paints after persistence is _slow_ even if total work is identical. Measure when pixels change (mark in the handler, measure in a `requestAnimationFrame`-after-commit or paint-adjacent callback), not just how much work runs.
- Evaluate the code on its merits. Treat claims in CLAUDE.md or comments (e.g. "this is debounced", "this is cached") as hypotheses to verify against the code and the measurements, not settled facts.

## Known suspects (optional)

If prior work has raised specific suspicions, list them as **hypotheses to verify or refute** — the report must state a verdict on each (confirmed / refuted / couldn't verify), backed by a measurement where possible.

- _(none listed)_

## Budget

- **Use the existing big-vault generator — do not write a new one.** The example vault is too small to expose scaling problems. A deterministic large-vault generator already exists at `src/storage/devFixtures/testVaultGen.ts`, wired into the example backend: run `localStorage.setItem('meridian_bigvault', '300')` in the browser console, then (re)load the Tutorial vault. Run all measurements against this vault and note its size (the number you passed) in the coverage statement. It is dev-only (`import.meta.env.DEV`) and dead-code-eliminated from production builds, so it cannot be used against a prod build.
- Skim the full directory tree so nothing is invisible to you.
- Read closely: the store (`store.ts`, `storeBridge.ts`) and every selector/subscription pattern it exposes; the components rendered per occurrence/row in agenda view (these multiply — a small waste per row is a big waste per screen); the toggle/save/commit path (`occurrenceActions.ts`, `storeCommit.ts`, `persistencePort.ts`); the search implementation (`search/`) end to end from keystroke to result click; the editor's update/decoration path; the route definitions and what each view mounts.
- **Read the build and loading story, not just the source:** the Vite config, route-level lazy loading (or its absence), the service worker / PWA caching setup, and the dependency list for heavyweight imports reachable from the entry point. Run the production build and record chunk sizes.
- **Check where persistence work runs relative to paint:** for each mutating flow, measure whether YAML serialization, IndexedDB writes, and sync happen before or after the UI updates, and whether they run on the main thread synchronously with the interaction.
- Sample the rest. Record anything skipped in the coverage statement.

## Output structure

### 1. Snappiness verdict (~5 sentences)

Plain-language summary: overall, where does the app do unnecessary or badly-timed work? Name the **worst one or two flows** from the list above (with their headline numbers) and the **single biggest structural theme** (e.g. "every mutation re-renders the whole visible agenda because subscriptions are file-granular, not occurrence-granular"). This is the headline; the findings are the evidence.

### 2. Coverage statement

- Which flows you traced AND measured end to end, which you only traced statically, and which you skipped — with the reason.
- The test vault used (size, how generated, where the generator lives).
- Any flow or layer you suspect has issues but lacked budget to measure — flag as "unverified."

### 3. Findings — top 5

For each finding:

- **Title** — short label
- **Flows affected** — which of the numbered flows above, and roughly how often a user hits it (every keystroke / every toggle / every view switch / once per launch)
- **Category** — one or more of: `render-amplification` `critical-path-work` `perceived-latency` `bundle-and-startup` `data-and-persistence` `search-latency` `editor-latency` `memory-and-leak`
- **Impact** — 1–10, where impact = _perceived cost per occurrence × frequency of the flow_ (10 = visible jank on an every-interaction path; 5 = noticeable delay on a daily-but-not-constant action; 1 = measurable but imperceptible)
- **Baseline measurement** — the number(s) captured on the test vault (ms, render count, kB, …), stated with the conditions (vault size, view, interaction)
- **Measurement recipe** — the exact re-runnable steps and instrumentation that produced the baseline, precise enough that a later session can rerun it unchanged to verify a fix
- **Breadth** — number of files (or components-per-screen, where multiplication is the point) affected; counts from an actual search or build output — name the search/command; write "est." if estimated
- **Fix effort** — S / M / L
- **Evidence** — at least one file path plus a short **verbatim code quote** (copy-pasted, not paraphrased — I will spot-check by grepping) identifying the code responsible for the measured cost
- **Problem** — one sentence: what work is unnecessary, too frequent, or wrongly timed — and what the user feels as a result
- **Fix** — one sentence: the concrete change, plus the **expected effect on the baseline number** (e.g. "render count per toggle should drop from ~180 to ~2")

Rank by `(impact × breadth) ÷ effort`, but report the fields separately so the reader can re-sort.

**Strongly prefer structural findings over isolated ones.** "Every occurrence row subscribes to the whole store" beats "this one component lacks `useCallback`." Cite real code and real numbers — no generic React-performance boilerplate.

Do not pad to 5 — if fewer clear issues exist, stop there.

---

## Categories to scan — ranked by priority

The ranking is a tiebreaker, not a filter — a severe finding in any category outranks a minor one in a higher category. Bullets are illustrative examples, not the category's boundary.

### 1. Render amplification _(highest weight)_

**Scope:** one state change causing more component re-renders than the pixels that actually changed.

- Store subscriptions that select broad slices (whole file map, whole occurrence list) so every mutation re-renders every subscriber
- Missing `memo` at _list-item boundaries_ (occurrence rows, day cells) where a parent re-render fans out to hundreds of children — fine-grained `useMemo` inside a leaf is out of scope
- Unstable props defeating memoization: object/array/closure literals created per render and passed into memoized children
- Context providers whose value identity changes on every render
- Derived data (sorting, filtering, occurrence expansion) recomputed per render instead of memoized per input change

### 2. Critical-path work & perceived latency

**Scope:** work that runs between a user interaction and the resulting paint, or UI that waits for work it doesn't need to wait for.

- Mutations that serialize YAML / write IndexedDB / trigger sync _before_ the UI reflects the change, instead of optimistic update + async persist
- Synchronous heavy computation (occurrence expansion, repeat-rule evaluation, search indexing) inside event handlers or render, with no deferral (`startTransition`, idle callback, worker)
- Missing debounce/throttle on high-frequency inputs (typing, scrolling, resize) that trigger expensive recomputation per event
- Layout thrash: reading layout (offsetHeight, getBoundingClientRect) interleaved with writes in a loop

### 3. Search latency

**Scope:** keystroke-to-results time in the search bar, and the cost of acting on a result.

- Search recomputed from scratch (full scan over all files/occurrences) on every keystroke with no index, debounce, or incremental narrowing of the previous result set
- Index built lazily on first search (first-keystroke stall) or rebuilt wholesale on every vault mutation
- Result rendering that mounts heavyweight components per result row
- Result click or create-new-from-search doing avoidable synchronous work before navigation/editor-open paints

### 4. View switching & navigation cost

**Scope:** the cost of moving between views and dates.

- Views that fully unmount/remount and recompute everything on every switch when the data didn't change
- No caching/reuse of expensive per-view derivations (expanded occurrences, month grids) across navigation
- Effects re-running on navigation due to unstable dependencies
- Missing `key`-stability causing list teardown/re-creation instead of reconciliation

### 5. Bundle size & startup

**Scope:** time from launch to interactive, and what the initial bundle pays for.

- Missing route/feature-level code splitting — the editor, debug tooling, or rarely-used dialogs loaded eagerly in the entry chunk (verify against actual build output, not imports alone)
- Heavyweight dependencies reachable from the entry point that only a sub-flow needs
- Vault/data loading that blocks first paint when a cached shell + progressive load would do; service-worker caching strategy that misses obvious wins
- Startup work (parsing all files, building indexes) done eagerly that could be lazy or incremental

### 6. Data & persistence efficiency

**Scope:** the volume and frequency of parse/serialize/storage work.

- Whole-vault or whole-file reprocessing where a single entry changed (re-parse all files, re-expand all occurrences)
- IndexedDB access patterns: per-item transactions in a loop instead of batched; reads on the render path
- Sync work triggered more often than needed, or not coalesced across rapid successive edits
- Redundant round-trips: model → YAML → model conversions inside one flow

### 7. Editor keystroke latency

**Scope:** per-keystroke cost in CodeMirror.

- Decoration/plugin recomputation over the whole document per keystroke instead of viewport/changed-range
- Store or React state updated per keystroke, dragging the React tree into every keypress
- Expensive linting/parsing per update with no debounce or incremental strategy

### 8. Memory & degradation over time

**Scope:** performance that decays with session length or vault size.

- Listeners/subscriptions/observers added but never cleaned up in effect teardown
- Unbounded caches or history retention
- Scaling cliffs: O(n²) patterns over files/occurrences that feel fine in the example vault but degrade with a large real vault (state the n at which it hurts)

---

**Scoring guidance:** A finding on an every-interaction path (typing, toggling, searching) scores above an equal-sized finding on a once-per-session path (startup) — but a startup finding measured in whole seconds still beats a 5 ms toggle finding. A structural fix that mechanically speeds up _all_ flows (subscription granularity, optimistic-update pattern in the shared commit path) scores like the class of issues it fixes, not like one callsite. Skip micro-optimizations invisible at 60 fps — they belong in a profiler session, not this report.
