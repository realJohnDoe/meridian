# Vault-scaling stress test — findings

Open findings from the vault-scaling stress test run on 2026-08-28 against
`54ab5cb`. **The report they came from is `plans/surveys/vault-scaling.md`** —
the method, the full curves, and the two structural answers (occurrences are
the scaling unit; the JS heap, not Dexie, is the ceiling) live there and stay
there. This file is the to-do half: remove a finding's entry, and its row in
the table, in the PR that fixes it, and delete this file entirely once the
last one closes — see `plans/CLAUDE.md`.

**`scripts/perf/` retires with this file.** The harness exists to verify these
fixes by re-measurement; once the last finding closes it has no remaining
caller, and nothing in CI runs it, so it would rot silently. Delete
`scripts/perf/`, its two `knip.json` allowances and the
`scripts/perf/results/` line in `.gitignore` in the same PR that deletes this
file. The report stays: it is a record of what was measured, not a tool.

Every finding carries the baseline that measures it and the exact command that
produced that baseline, so a fix is verified by re-running the same command and
comparing. `scripts/perf/README.md` explains the harness and its caveats; the
short version is that it runs against the **dev server** (the large-vault
generator is dev-only), so the pipeline numbers are close to production but the
UI numbers carry dev-React overhead — read them as a curve and as a
before/after comparison, not as shipped latency.

## Findings

Ranked by `(impact × breadth) ÷ effort`. `#` is a stable identity, not a
priority — the numbers do not move as findings get closed out.

| Rank | # | Finding | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|
| 2 | 2 | `fileOccurrenceMap` expands ±3 years to pick one occurrence per file | 8 | 2 | **Sonnet 5** — bounded seek; design settled below |
| 6 | 4 | Scroll cost grows with vault size although mounted rows stay constant | 7 | 2 | **Sonnet 5** for the instrumentation; re-tier once it reads |

Both are Sonnet-5 work **as written**, and only as written. Each carries the
design decision already made, the correctness spec that constrains it, and the
named tests — strip those and both revert to Opus 5.

They are not the same kind of task. Finding 2 has a diagnosis and a settled
design, so its block is an implementation plan. Finding 4 has neither, so its
block is an *instrumentation* plan: it says what has already been ruled out,
what the one matching suspect is, and how to attribute the frame time
automatically — and it deliberately stops short of a fix. Do not skip to
step 4 of it.

---

### 2. `fileOccurrenceMap` expands a ±3-year window to pick one occurrence per file

- **Flows** — opening search, opening the editor, the entry route; indirectly
  every load, via the idle warm-up.
- **Category** — `critical-path-work`, `memory-and-leak`
- **Impact** — 8
- **Baseline** — 133 ms at 300 files, 1 111 ms at 3 000, 4 227 ms at 10 000,
  10 448 ms at 30 000, 62 701 ms at 100 000 (mixed); 65 ms at flat/30 000. It
  is the single largest heap consumer: +504 MB over baseline at mixed/30 000,
  where the agenda's own expansion accounts for +269 MB.
- **Measurement recipe** —
  `node scripts/perf/stress.mjs --shapes mixed,flat --sizes 3000,30000 --skip-ui --skip-dexie`;
  read `pipeline.result.fileOccurrenceMap.cold` and `pipeline.result.heapMB`.
- **Breadth** — `src/fileOccurrence.ts` and its two consumers
  (`hooks/useFileOccurrenceMap.ts`, `search/FileResultsList.tsx`).
- **Evidence** — `src/fileOccurrence.ts`:
  ```ts
  const _3YR_MS = 365 * 3 * 86_400_000
  ```
  ```ts
  const inWindow = expandRange(keyItems, roots, BACK, AHEAD) // ascending by time
  ```
  ```ts
  const inWindow = expandRange(keyItems, roots, BACK, AHEAD) // ascending by time
  ```
  — run once per entry key, over a window 4.8× wider than the agenda's, to
  select a single representative.
- **Problem** — the map materialises ~4 M occurrences at 30 000 files to keep
  30 000 of them. It is already off the first-paint path (`warmFileOccurrenceMap`
  → `onIdle`), so the cost lands either in an idle slice or, if the user opens
  search before idle runs, inline in that interaction — and the peak allocation
  is paid either way.
- **Fix** — **replace expand-then-filter with a bounded seek.** The six fill
  rules only ever want the nearest upcoming event, the earliest undone task,
  the most recent past event, or the latest done one; none of them needs the
  window materialised. This is the shape every RFC 5545 implementation
  already uses for the "which occurrence is nearest to *t*" question —
  rrule.js's `.after()`/`.before()`, ical.js's `RecurExpansion.next()`,
  dateutil's `rrule` generator. Two halves, because the walk only runs
  forwards:
  - **Forward: lazy, with early bail.** Pull occurrences ascending from `now`
    and stop at the first one the rule chain accepts. Most keys are decided by
    rule 1 on the first or second yield.
  - **Backward: one fixed window, `[now − OVERDUE_LOOKBACK_DAYS, now]`.** Not
    galloped and not 3 years — `overduePool.ts` already owns this project's
    answer to "how far back do we look", and rule 2 is *for* overdue tasks. It
    is currently 365 days.

  Expected effect: at mixed/30 000, from ~10 400 ms and +504 MB to a small
  multiple of the key count. The three-year back window disappears outright
  and the forward side stops materialising anything it does not return.

- **Read this before starting: `expandRange` cannot itself become a
  generator.** `expandNode` (`src/model/expansion.ts:506`) does **not** emit in
  time order — it pushes the anchor first, then the generated dates ascending,
  then out-of-band instances, then the `after_completion` branch, then nested
  child series appended at the end. The ascending order `resolveOneKey`'s
  `// ascending by time` comment relies on comes entirely from `dedupeAndSort`
  at the *end* of `expandRange` (`expansion.ts:745`, `:853`), which needs the
  whole array. A naive `function*` conversion of `expandRange` yields
  out-of-order occurrences and silently returns the wrong representative.

  So the laziness goes one level down, at the date walk, plus a k-way merge
  per key. **The merge is cheap only because the seek is per key**: `entry.items`
  is one file's items — typically 1–20 — so merging that many iterators by
  next `jsTime` costs nothing. This is why the fix belongs in
  `fileOccurrence.ts`'s call pattern and a new `model/` seek helper, and *not*
  in a global rewrite of `expandRange`, which serves callers (the agenda, the
  month grid) that genuinely want the whole window.

- **The correctness spec — which rules a partial window may decide.** This is
  the part that silently returns the wrong search result if it is got wrong,
  and it is why the current ±3-year constant cannot simply be shrunk:

  | Rule | Selection | Safe to decide from a partial forward window? |
  |---|---|---|
  | 1. nearest upcoming event | nearest to `now`, forward | **Yes** — the first match found *is* the global answer |
  | 2. earliest undone task | extremal (oldest), backward-then-forward | **Only** with the full back window; its forward half is nearest-to-now and is safe |
  | 3. undated open task | read from `keyItems`, no window | **Yes** — window-independent |
  | 4. most-recent past event | nearest to `now`, backward | **Yes**, within the fixed back window |
  | 5. latest done occurrence | extremal (latest) | **No** — needs the full forward horizon |
  | 6. fallback | `keyItems`, no window | **Yes** — window-independent |

  Rules 1, 3 and 4 may return as soon as they match. Rules 2 and 5 are
  *extremal* over the window, so a match in a narrow window is not the global
  answer — this is the trap in "just narrow ±3yr to ±1yr", which changes
  results for both and is not covered by a test for out-of-window series.
  Rule 2 is fixed by binding its back edge to `OVERDUE_LOOKBACK_DAYS`
  permanently (then its overdue half is complete at every step and its forward
  half is nearest-to-now). Rule 5 is only ever reached when rules 1–4 all
  missed, i.e. the file's entire content is completed — rare enough to let it
  run to the forward horizon.

- **Two deliberate behaviour changes, each needing a test.** Both are
  acceptable; neither should be discovered later from a bug report:
  1. A file whose most recent past event is older than `OVERDUE_LOOKBACK_DAYS`
     now falls through rule 4 to rule 6, which returns the first standalone
     item as-is rather than the most recent one. For a single-item file the
     result is identical; for a file with several old events it differs.
  2. A series whose only occurrences fall beyond the forward horizon still
     lands on rule 6's synthetic anchor, exactly as today.

- **Recommended model** — **Sonnet 5**, given the context block below. The
  design decision (where the laziness goes, and why not in `expandRange`) is
  made above; what remains is a contained mechanical change with a written
  correctness spec and named tests.

- **Task context** — four steps, in this order:

  1. **Make the date walk a generator.** `generateScheduledDates`
     (`src/model/expansion.ts:213`) ends with
     `return results.filter(d => d >= from && d <= to)`. Convert it to
     `function* iterScheduledDates(...)` that `yield`s each date passing that
     same predicate instead of pushing to `results`, and keep
     `generateScheduledDates` as a one-line `[...iterScheduledDates(...)]`
     wrapper — it is module-private and `expandNode`'s schedule branch is its
     only caller, so keeping the wrapper is what makes this step a **provable
     pure refactor** rather than a behaviour change bundled into a bigger one.
     The walk is already the right shape for this: it has analytic
     skip-ahead to `from`
     (`periodsBetween`/`advanceCursor`) and stops at
     `min(seriesEnd, windowEnd)`, so a consumer that stops early genuinely
     stops the work. Leave `PERIOD_WALK_LIMIT` as the backstop it is.

  2. **Add the per-key seek to `model/`.** A new exported function in
     `expansion.ts` — e.g.
     `firstOccurrenceFrom(items, roots, from, horizon, pred)` — that lazily
     merges, ascending by `jsTime`, one iterator per item in `items` (series
     via `iterScheduledDates`, standalones as a single-element sequence) and
     returns the first occurrence satisfying `pred`, or `null` at `horizon`.
     Reuse `joinFileMeta` and `stableOccId` so the returned occurrence is
     **identical in shape and id** to what `expandRange` produces for the same
     slot — `FileResultsList` and `ItemsList` key off these. A plain
     "peek each iterator, take the min" loop is fine; do not add a heap.
     Note `expandNode`'s override merging (`findOverrides`/`emitSlot`) must be
     honoured for a slot carrying an override child, or a moved or excluded
     occurrence comes back wrong — reuse that logic rather than re-deriving it.

  3. **Rewrite `resolveOneKey`** (`src/fileOccurrence.ts:69`). Rules 1, 2-future
     and 5-future come from `firstOccurrenceFrom`; rules 2-overdue, 4 and
     5-past come from one
     `expandRange(keyItems, roots, addDays(now, -OVERDUE_LOOKBACK_DAYS), now)`.
     Rules 3 and 6 are unchanged — they read `keyItems` directly. Delete
     `_3YR_MS` (`src/fileOccurrence.ts:52`) and the `AHEAD`/`BACK` parameters
     threaded through `updateFileOccurrenceMap`.

     **Where `OVERDUE_LOOKBACK_DAYS` should live.** It is currently
     `src/calendar/overduePool.ts:19` (365), and `overduePool` is its only
     reader. Do **not** duplicate it, and do not reach for it from
     `fileOccurrence.ts` via `@/calendar`: no root-level file imports
     `@/calendar` today, and adding the first such edge for a constant is the
     wrong trade. **Move it into `model/`** and have `overduePool.ts` import it
     from `@/model` — `fileOccurrence.ts` already imports `@/model`, so this
     adds no new edge anywhere, and "how far back does overdue reach" is a
     domain policy now shared by two consumers rather than one view's private
     number. Check `GLOSSARY.md:446`, which names the constant (without a file
     path, so it likely needs no edit — but `src/glossary.test.ts` is what
     decides, and it must stay green).

     Update `resolveOneKey`'s own doc comment while you are there: it
     enumerates the six rules and names the ±3-year window in each, and it is
     the only written statement of the fill order anywhere in the codebase.

  4. **Keep the map total over `roots`.** The doc comment on
     `updateFileOccurrenceMap` and `FileResultsList`'s `flatMap` both depend on
     a `.get()` miss being impossible. Rule 6 is what guarantees it and is
     window-independent, so totality survives — but assert it, don't assume it.

  Tests to run and extend: `src/model/__tests__/memo-identity.test.ts`,
  `src/model/__tests__/linking.test.ts`, `src/store.test.ts`,
  `src/search/FileResultsList.test.tsx`, `src/editor/ItemsList.test.tsx`, plus
  `src/model/__tests__/` coverage for `generateScheduledDates` (step 1 must be
  provably a pure refactor — the array wrapper's output should be
  byte-identical to today's for every existing case). Add cases for: a series
  whose only occurrences fall beyond the forward horizon; a file whose most
  recent past event is older than `OVERDUE_LOOKBACK_DAYS` (behaviour change 1);
  a key whose earliest undone task is 11 months overdue (rule 2 must still find
  it, which is the case a galloped forward-only window would get wrong); and a
  series slot carrying an override child, to pin step 2's override handling.

  **Verify by re-measurement, not by eye** — re-run the recipe above and
  compare `pipeline.result.fileOccurrenceMap.cold` and
  `pipeline.result.heapMB` against the baselines recorded here.

---

### 4. Scroll cost grows with vault size although mounted rows stay constant

- **Flows** — scrolling the agenda (continuous).
- **Category** — `render-amplification`, `perceived-latency`
- **Impact** — 7
- **Baseline (remeasured after the agenda moved to incremental loading)** —
  p50 frame interval while scrolling 30 × 900 px: 49.9 ms at mixed/3 000,
  133.3 ms at mixed/30 000 (worst 66.7 / 183.3 ms; janky frames 10/30 →
  30/30). Both smaller in absolute terms and a flatter curve than the old
  fixed-window baseline (33.4 → 200 ms, a 6× jump for the same 10× file-count
  move; now 2.7×) — but not gone. Mounted rows hold at 26 for both sizes,
  confirming (again, on the new architecture) that this is not row mounting.
- **Measurement recipe** — `node scripts/perf/stress.mjs --sizes 3000,30000`;
  read `ui.scroll` and `ui.mountedRows`.
- **Breadth** — `scripts/perf/stress.mjs` (step 1),
  `src/model/expansionCache.ts` (step 2), `calendar/AgendaView.tsx` +
  `calendar/viewState.ts` (step 4, only if step 1 confirms it).
- **Problem** — still not diagnosed. What follows narrows it: a code read has
  ruled several suspects out, found one small real waste, and left one suspect
  that matches the measured signature exactly. **Do step 1 before step 3 or 4.**

- **Ruled out by inspection** — do not re-investigate these without evidence:
  - *Row mounting* — 26 mounted rows at both sizes, already measured.
  - *`computeOverduePool`* (`calendar/overduePool.ts:128`) — identity-cached on
    `items`/`roots`/`todayMs`/`filterOccs`, and `filterOccs` is a `useCallback`
    over three store values that do not change while scrolling. Hits its cache.
  - *`hasSameStructure`* (`model/expansionCache.ts:82`) — opens with
    `if (a === b) return true`, so it is O(1) during scroll.
  - *`useAgendaChunks`'s run memo* — works; it compares each chunk's `allOccs`
    rather than the `ExpansionCache` wrapper, deliberately, because the
    wrapper is reallocated even on a no-op.
  - *Store-write fan-out from `setAgendaTopDate`* — it does reach `_app.tsx`,
    `Sidebar` and `SearchBar`, but it only fires on a **day-boundary crossing**,
    and crossings get *rarer* as the vault grows (~408 agenda rows per day at
    mixed/30 000 against ~40 at mixed/3 000, so 900 px crosses a boundary
    constantly at 3 000 and almost never at 30 000). It cannot produce a cost
    that grows with vault size. **This disconfirms the `items`/`roots` "prime
    suspect" this finding previously named.**

- **The one real waste found, worth fixing regardless of the profile.**
  AgendaView re-renders on *every* scroll event by design (its own comment at
  `calendar/AgendaView.tsx:280` says so — `virtualItems` is read fresh each
  render). That runs `computeExpansionCache` once per loaded chunk per scroll
  event, and its fast path does an **unguarded O(items) walk** at
  `src/model/expansionCache.ts:151` even when `items === prev.items`. The very
  next block guards its `roots` equivalent with `if (roots !== prev.roots)`;
  the `items` loop has no such guard. Add
  `if (items === prev.items && roots === prev.roots) return prev` immediately
  after the `hasSameStructure` gate at `:138`. Returning `prev` **by reference**
  is deliberate and better than the existing `{ ...prev, items, roots }` — see
  `sameChunks`'s comment in `calendar/useAgendaChunks.ts:23`, which exists only
  to work around that reallocation. Expect this to be worth ~1–2 ms per scroll
  event, not 133 ms; it is one line of pure waste, not the finding.

- **Prime suspect: TanStack Virtual's measurement rebuild.** Rows are
  dynamically measured — `ref={virtualizer.measureElement}` in
  `src/components/primitives/virtual-rows.tsx:41`. The virtualizer rebuilds its
  `measurements` array from the lowest pending measured index through `count`
  whenever a row measures differently from its `estimateSize`, which
  `useVirtualFlip`'s own doc comment says "happens constantly while scrolling
  through not-yet-measured rows". That gives cost per scroll event proportional
  to **total row count** with **mounted rows constant** — precisely the observed
  signature, and precisely what ruling out row *mounting* does not rule out.
  It also explains why chunking flattened the curve without removing it: rows
  per day still scale with vault size, so the same 30 × 900 px flow holds
  ~34 000 rows at 30 000 files against ~3 400 at 3 000.

- **Fix — step 1 is instrumentation, not a fix.**

  1. **Attribute the frame time in the harness, not by hand.** The previous
     version of this finding asked for a Chrome performance profile attached
     manually. Don't — it is a one-shot that cannot be diffed across vault
     sizes, and `scripts/perf/` is deleted when this file closes, so building
     the attribution into it now is the last moment it pays for itself. Add a
     `PerformanceObserver` for the **Long Animation Frames API**
     (`{ type: 'long-animation-frame', buffered: true }`) around the existing
     scroll flow in `scripts/perf/stress.mjs` — the `flow('scroll', ...)` call
     at `:191`, whose `page.evaluate` already wraps the 30 x 900 px loop in
     `window.__perf.frames()`. Register the observer inside that same
     `page.evaluate` before the loop and drain it after, so the entries are
     scoped to the scroll and come back alongside the frame stats `flow()`
     already stores. Report the top attributions per size. LoAF is the
     current standard for this question and the first version of it with
     attribution: each entry carries
     `blockingDuration`, `renderStart`, `styleAndLayoutDuration`, and a
     `scripts[]` array with `invoker`, `sourceURL`, `sourceFunctionName` and
     `sourceCharPosition`. Report it beside `ui.scroll` so it is comparable
     across sizes and across runs. (INP is the wrong metric here — a continuous
     scroll is not an INP interaction. If LoAF's attribution is too coarse,
     escalate to a CDP `Profiler.start`/`Profiler.stop` sampling profile
     through the session the harness already drives.)

  2. **Land the `computeExpansionCache` guard above.** Independent of the
     profile, one line, and it removes a confound from step 1's reading — do it
     first so the profile is not attributing waste that is already known.

  3. **Read the profile before writing any fix.** If `styleAndLayoutDuration`
     dominates, it is measurement/layout and the suspect above is confirmed.
     If `scripts[]` points into React render, it is not — and the suspects
     ruled out above are already eliminated, so that would be a genuinely new
     lead.

  4. **Only if the virtualizer is confirmed:** the standard mitigations are
     bounding `count` and making each measurement cheaper. `count` is the more
     promising of the two here — the loaded run only ever *grows* forward
     within its ±365/+90-day cap (`growAgendaLoadedChunksForward`,
     `calendar/viewState.ts`), so a long scroll session monotonically increases
     `rows.length`; a sliding window that also drops chunks far behind the
     viewport is the usual answer, and `useAgendaChunks` already has the
     eviction machinery (its commit-phase `useEffect` drops chunks outside the
     requested run — only the run itself needs to shrink).
     `content-visibility: auto` plus `contain: layout style paint` on rows is
     the cheaper-measurement leg.
     Both are behaviour-visible on a scroll-restore path that has been got
     wrong twice before (see `computeAgendaScrollRestore`'s own notes) — do not
     start here.

- **Recommended model** — **Sonnet 5 for steps 1 and 2**, which are the whole
  of the immediate work: a `PerformanceObserver` added to an existing harness
  flow, and a one-line cache guard. Steps 3 and 4 are a fresh decision once
  the profile exists, and step 4 in particular touches agenda scroll restore —
  re-tier it then rather than now.
- **Why it is listed anyway** — it is still a measurably bad flow at scale
  (133 ms p50, every frame janky), and it is the last finding for which the
  perf harness is the verification tool, so the instrumentation in step 1 is
  the thing that has to happen before `scripts/perf/` retires.
