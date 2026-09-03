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
| 6 | 4 | Scroll cost grows with vault size although mounted rows stay constant | 7 | 2 | Instrumented and profiled; re-tier for what's next |

Finding 2 is Sonnet-5 work **as written**, and only as written. It carries the
design decision already made, the correctness spec that constrains it, and the
named tests — strip those and it reverts to Opus 5.

Finding 4's instrumentation and cache-guard work is done — see its own
section for the profile that came back and what it ruled out. What remains
of it has neither a diagnosis nor a settled design, so re-tier it fresh once
finding 2 lands rather than reusing either row's model above.

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
  read `ui.scroll` (now carrying a `loaf` attribution — see
  `scripts/perf/table.mjs`'s "Long animation frames (scroll)" table) and
  `ui.mountedRows`.
- **Breadth** — `scripts/perf/stress.mjs`, `src/model/expansionCache.ts`
  (both landed — see below), `calendar/AgendaView.tsx` +
  `calendar/viewState.ts` (only if a fix is still needed once the profile
  below is acted on).
- **Problem** — the harness now attributes scroll frame cost via the Long
  Animation Frames API, and `computeExpansionCache` no longer walks `items`
  on a true no-op (both landed — see "Landed" below). The resulting profile
  does not confirm the virtualizer theory this finding previously led with;
  read "Profile reading" below before doing anything further here.

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

- **Landed.** `scripts/perf/stress.mjs`'s scroll flow now brackets its
  30 × 900 px loop with a `PerformanceObserver` for the Long Animation Frames
  API, reporting the top attributed scripts plus `blockingMs` and
  `styleAndLayoutMs` totals as `ui.scroll.loaf` (`scripts/perf/table.mjs` has
  a matching "Long animation frames (scroll)" table). Separately, AgendaView
  re-renders on *every* scroll event by design (its own comment at
  `calendar/AgendaView.tsx:280` says so — `virtualItems` is read fresh each
  render), which ran `computeExpansionCache` once per loaded chunk per scroll
  event; its fast path did an **unguarded O(items) walk** at
  `src/model/expansionCache.ts:151` even when `items === prev.items`, while
  the very next block already guarded its `roots` equivalent. It now returns
  `prev` by reference when both are unchanged, immediately after the
  `hasSameStructure` gate — worth ~1–2 ms per scroll event, not the finding
  itself.

- **Profile reading (mixed/3 000 and mixed/30 000,
  `--skip-pipeline --skip-dexie`).** The captured LoAF attribution does
  **not** confirm the virtualizer theory below — a different, larger
  contributor dominates at both sizes:

  | Attribution | mixed/3 000 | mixed/30 000 |
  |---|---|---|
  | `IdleRequestCallback` (`lib/idle.ts` — finding 2's `warmFileOccurrenceMap`) | 1 306 ms | 12 760 ms |
  | `IDBRequest.onsuccess` (Dexie cache write from cold start) | 1 279 ms | 10 871 ms |
  | React commit (`react-dom_client.js`) | 917 ms | 6 942 ms |
  | `DIV.onscroll` (TanStack Virtual's own scroll handler) | 402 ms | 1 937 ms |
  | style+layout recalc, summed across all LoAF entries | 8.9 ms | 19.5 ms |

  - **Style/layout recalc is negligible at both sizes** — single digits to
    ~20 ms out of a multi-second scroll. The "measurement rebuild is a
    layout cost" half of the suspect below does not hold up.
  - **The virtualizer's own handler (`DIV.onscroll`) is real but minor** —
    behind three other contributors at both sizes, not the dominant cost.
  - **`IdleRequestCallback`'s 30 000-file figure (12 760 ms) lands almost
    exactly on finding 2's own `fileOccurrenceMap` baseline (10 448 ms).**
    Cold start at 30 000 files takes ~24 s wall-clock, so the idle callback
    that kicks off `warmFileOccurrenceMap` is still mid-flight when this
    flow's scroll starts, and its main-thread time lands inside whichever
    LoAF entries happen to overlap it — including ones inside the scroll
    window. `IDBRequest.onsuccess` is the same cold start's Dexie write.
    Neither is caused by scrolling — this is a **flow-order confound**: the
    harness scrolls immediately after toggling, right after a cold load,
    before the browser has had idle time to drain the warm-up backlog. It is
    still a real interaction, not only a test artifact — a user who starts
    scrolling immediately after opening a large vault would hit the same
    overlap.

  Finding 2's fix is the more promising lever to try first: it should
  collapse the `IdleRequestCallback` contribution. Re-run this profile once
  finding 2 lands and read what's left before deciding whether the
  virtualizer needs its own mitigation.

- **Suspect going in, not confirmed by the profile above: TanStack Virtual's
  measurement rebuild.** Rows are dynamically measured —
  `ref={virtualizer.measureElement}` in
  `src/components/primitives/virtual-rows.tsx:41`. The virtualizer rebuilds
  its `measurements` array from the lowest pending measured index through
  `count` whenever a row measures differently from its `estimateSize`, which
  `useVirtualFlip`'s own doc comment says "happens constantly while scrolling
  through not-yet-measured rows" — cost proportional to **total row count**
  with **mounted rows constant**, the observed signature. But the profile
  above attributes most of the cost elsewhere, at least until the flow-order
  confound is removed.

- **Next steps — a fresh decision, not scoped here.** Land finding 2, re-run
  the measurement recipe above, and read `ui.scroll.loaf` again. If
  `IdleRequestCallback`/`IDBRequest.onsuccess` collapse and a
  `DIV.onscroll`-shaped residual remains proportional to row count, the
  standard virtualizer mitigations are bounding `count` (the loaded run only
  ever *grows* forward within its ±365/+90-day cap —
  `growAgendaLoadedChunksForward`, `calendar/viewState.ts` — so a sliding
  window that also drops chunks far behind the viewport, using
  `useAgendaChunks`'s existing eviction machinery, is the usual answer) and
  making each measurement cheaper (`content-visibility: auto` plus
  `contain: layout style paint` on rows). Both are behaviour-visible on a
  scroll-restore path that has been got wrong twice before (see
  `computeAgendaScrollRestore`'s own notes) — re-tier before starting there.

- **Recommended model** — the instrumentation and the cache guard are done;
  what remains (landing finding 2, re-reading the profile, and only then a
  possible virtualizer fix on the scroll-restore path) is a fresh decision —
  re-tier once finding 2 lands rather than now.
