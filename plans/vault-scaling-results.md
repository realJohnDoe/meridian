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
| 6 | 4 | Scroll cost grows with vault size although mounted rows stay constant | 7 | 2 | Instrumented and profiled; re-tier for what's next |

Finding 4's instrumentation and cache-guard work is done — see its own
section for the profile that came back and what it ruled out. Finding 2 has
now landed too, so re-tier what remains fresh once its fix is re-measured,
rather than reusing either row's old model recommendation.

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
  collapse the `IdleRequestCallback` contribution. It has now landed —
  re-run this profile and read what's left before deciding whether the
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

- **Next steps — a fresh decision, not scoped here.** Finding 2 has landed;
  re-run the measurement recipe above, and read `ui.scroll.loaf` again. If
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
  what remains (re-reading the profile now that finding 2 has landed, and only
  then a possible virtualizer fix on the scroll-restore path) is a fresh
  decision — re-tier now rather than reusing this row's old model.
