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
| 6 | 4 | Scroll cost grows with vault size although mounted rows stay constant | 7 | 2 | Re-profiled after finding 2 landed; re-tier for what's next |

Finding 4's instrumentation, cache-guard, and two follow-up fixes to
`fileOccurrenceMap` itself (found by profiling this finding after finding 2
landed) are all done — see its own section for the full story and what's
actually left. The scroll-jank metric this finding tracks has **not**
improved despite all of that; re-tier what remains fresh rather than reusing
this row's old model recommendation.

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
  **Still unchanged after every fix below**: 33.4 ms / 83.4 ms p50 (worst
  50.1 / 116.7 ms, janky 2/30 → 29/30) at mixed/3 000 → mixed/30 000, the most
  recent re-measurement. Landing finding 2 and its follow-ups moved the LoAF
  attribution around substantially (see "Profile reading" below) without
  moving this number at all.
- **Measurement recipe** — `node scripts/perf/stress.mjs --sizes 3000,30000`;
  read `ui.scroll` (now carrying a `loaf` attribution — see
  `scripts/perf/table.mjs`'s "Long animation frames (scroll)" table) and
  `ui.mountedRows`.
- **Breadth** — `scripts/perf/stress.mjs`, `src/model/expansionCache.ts`,
  `src/fileOccurrence.ts` + `src/model/expansion.ts` (all landed — see
  below), `calendar/AgendaView.tsx` + `calendar/viewState.ts` (only if a fix
  is still needed once "Next steps" below is acted on).
- **Problem** — the harness attributes scroll frame cost via the Long
  Animation Frames API, `computeExpansionCache` no longer walks `items` on a
  true no-op, and — found by profiling this finding, not part of the
  original plan — `fileOccurrenceMap` itself had two real performance bugs,
  now fixed (all landed, see "Landed" below). None of it moved the frame
  interval this finding tracks. Read "Profile reading" below.

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
  a matching "Long animation frames (scroll)" table). AgendaView re-renders
  on *every* scroll event by design (its own comment at
  `calendar/AgendaView.tsx:280` says so — `virtualItems` is read fresh each
  render), which ran `computeExpansionCache` once per loaded chunk per scroll
  event; its fast path did an **unguarded O(items) walk** at
  `src/model/expansionCache.ts:151` even when `items === prev.items`, while
  the very next block already guarded its `roots` equivalent — it now returns
  `prev` by reference when both are unchanged, immediately after the
  `hasSameStructure` gate.

  Profiling this finding after finding 2 landed surfaced two real bugs in
  `fileOccurrenceMap` itself, both now fixed: `resolveOneKey`
  (`src/fileOccurrence.ts`) computed its 365-day back window eagerly for
  every key even when rule 1 resolved first and never touched it, and
  `expandRange`/`firstOccurrenceFrom` each independently classified
  `keyItems` via their own `buildItemIndex` call — both fixed by making the
  back window lazy/memoized and sharing one `ItemIndex`. That alone barely
  moved the needle (see "Profile reading" below); the real cost was
  `firstOccurrenceFrom`'s contract — an unmatched predicate walks every
  occurrence to its 3-year horizon before giving up, and rule 1's own
  predicate (`occKind(o) === 'event'`, i.e. `!isTracked(o)`) can never match
  a task-only series, so every weekly task series (~7.5% of files at the
  `mixed` shape) paid for ~470 wasted pulls. Both seeks in `resolveOneKey`
  now skip outright when `keyItems` structurally cannot produce a matching
  kind, checked via `isTracked` — the same primitive `occKind` is built
  from, so this is provably correct rather than a heuristic.

- **Profile reading — three passes, same recipe
  (`--sizes 3000,30000 --skip-pipeline --skip-dexie`), read `ui.scroll.loaf`
  at mixed/30 000 each time.** None of it confirms the virtualizer theory
  below, and none of it moved the frame interval the Baseline above tracks:

  | Attribution | pre-finding-2 | post-finding-2 | post-both fixes above |
  |---|---|---|---|
  | `IdleRequestCallback` (`fileOccurrenceMap` warm-up) | 12 760 ms | 12 463 ms | **3 168 ms** |
  | `IDBRequest.onsuccess` (Dexie cache write from cold start) | 10 871 ms | 9 958 ms | 10 836 ms |
  | React commit (`react-dom_client.js`) | 6 942 ms | 6 881 ms | 7 040 ms |
  | `DIV.onscroll` (TanStack Virtual's own scroll handler) | 1 937 ms | 1 614 ms | 1 644 ms |
  | style+layout recalc, summed across all LoAF entries | 19.5 ms | 17.4 ms | 18.6 ms |
  | scroll p50 / worst frame interval | 100.1 / 133.3 ms | 83.4 / 216.7 ms | 83.4 / 116.7 ms |

  - **`fileOccurrenceMap`'s fix worked exactly as measured**: the two bugs
    above cut its own `pipeline.result.fileOccurrenceMap.cold` from
    ~10 400–12 200 ms to **3 072 ms** at mixed/30 000 (finding 2's own
    recipe), and `IdleRequestCallback` collapsed to match. Confirms the
    "flow-order confound" read from the previous profile — it really was
    `fileOccurrenceMap`'s own idle callback landing inside the scroll
    window.
  - **The frame interval this finding tracks did not move.** Total
    LoAF-attributed blocking dropped ~27% (30 351 ms → 22 213 ms combining
    all five rows), but p50/worst are statistically the same run to run —
    fixing the single biggest contributor didn't touch the thing being
    measured.
  - **`IDBRequest.onsuccess` (Dexie's cold-start cache write) is now the
    largest contributor, unchanged across all three passes.** Same
    flow-order confound as `fileOccurrenceMap` was, different source: cold
    start at 30 000 files takes ~24 s wall-clock and this harness flow
    scrolls immediately after toggling, right after that cold load — so
    whichever background task is still mid-flight (idle warm-up, Dexie
    sync) lands inside the scroll window's LoAF entries. It is still a real
    interaction (a user who scrolls right after opening a large vault would
    hit the same overlap), but it means **this harness flow cannot isolate
    steady-state scroll cost** — every profile so far is dominated by
    whatever cold-start work hasn't finished draining, not by scrolling
    itself.
  - **Style/layout recalc stays negligible throughout** (single digits to
    ~20 ms) — the "measurement rebuild is a layout cost" half of the
    suspect below stays unconfirmed.
  - **The virtualizer's own handler (`DIV.onscroll`) stayed flat (~1.6–1.9 s)
    across all three passes**, including the one where the dominant
    confound was removed. If it scaled with row count the way the theory
    predicts, clearing 9 000+ ms of unrelated background work should have
    made it a noticeably larger share of what's left — it didn't grow at
    all, in absolute terms or as a share of the total. This is the
    strongest evidence yet *against* the virtualizer theory, short of
    proof.

- **Suspect going in, still not confirmed by any profile taken so far:
  TanStack Virtual's measurement rebuild.** Rows are dynamically measured —
  `ref={virtualizer.measureElement}` in
  `src/components/primitives/virtual-rows.tsx:41`. The virtualizer rebuilds
  its `measurements` array from the lowest pending measured index through
  `count` whenever a row measures differently from its `estimateSize`, which
  `useVirtualFlip`'s own doc comment says "happens constantly while scrolling
  through not-yet-measured rows" — cost proportional to **total row count**
  with **mounted rows constant**, the observed signature. But its own LoAF
  attribution (`DIV.onscroll`) has stayed flat and minor through three
  passes with very different background-work profiles, which the theory
  doesn't predict.

- **Next steps — a fresh decision, not scoped here.** The measurement itself
  needs fixing before any more diagnosis is worth doing: add a settle wait
  to `scripts/perf/stress.mjs`'s scroll flow (idle-callback backlog drained,
  Dexie write's promise resolved) before starting the timed 30 × 900 px loop,
  so a profile actually isolates scroll cost instead of whichever cold-start
  background task is still mid-flight. Only once that reads cleanly is there
  a real basis to confirm or rule out the virtualizer — and if it's ruled
  out too, this finding may simply be "cold start's own background work
  competes with the first scroll," which is a different finding (and a
  different fix) than the one this file has tracked so far.

- **Recommended model** — a fresh decision. The harness fix above is small
  and mechanical (Sonnet 5 territory), but what it will reveal — and
  therefore what's worth building — isn't knowable until it's read.
