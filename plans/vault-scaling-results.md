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
  **Confirmed unchanged by every fix below, and now cleanly attributed**:
  33.3 ms / 99.9 ms p50 (worst 50.1 / 116.7–133.4 ms, janky 1/30 → 30/30) at
  mixed/3 000 → mixed/30 000, most recently — see "Profile reading" for what
  changed and what didn't.
- **Measurement recipe** — `node scripts/perf/stress.mjs --sizes 3000,30000`;
  read `ui.scroll` (carrying a `loaf` attribution and, since the settle-wait
  landed, a `settled` field — see `scripts/perf/table.mjs`'s "Long animation
  frames (scroll)" table) and `ui.mountedRows`.
- **Breadth** — `scripts/perf/stress.mjs`, `src/model/expansionCache.ts`,
  `src/fileOccurrence.ts` + `src/model/expansion.ts` (all landed — see
  below), `calendar/AgendaView.tsx` + `calendar/viewState.ts` (the confirmed
  fix — see "Next steps").
- **Problem** — the harness attributes scroll frame cost via the Long
  Animation Frames API and now settles cold-start background work out of the
  measurement window before timing the scroll; `computeExpansionCache` no
  longer walks `items` on a true no-op; and — found by profiling this
  finding, not part of the original plan — `fileOccurrenceMap` itself had two
  real performance bugs, also fixed (all landed, see "Landed" below). With
  all of that in place, the profile finally confirms this finding's original
  suspect: TanStack Virtual's measurement rebuild. See "Confirmed" below.

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

  With `fileOccurrenceMap` genuinely fixed, a fourth profile pass still
  showed the scroll flow's own frame interval untouched, and its LoAF
  attribution still dominated by an *unrelated* contributor: Dexie's
  cold-start cache write. That was the harness's own fault, not the app's —
  `scripts/perf/probe.mjs` now keeps one page-lifetime LoAF observer instead
  of the scroll flow registering its own mid-run, plus a
  `__perf.settle(quietMs, timeoutMs)` that waits until no LoAF entry has
  ended in the last `quietMs` (default 500 ms, 45 s cap) before the timed
  loop starts. The scroll flow awaits it, then reads only the entries inside
  its own timed window via the new `__perf.loafsIn(t0, t1)` — reading from
  the one shared, already-running observer rather than registering a second
  one is what stops the wait's own settled work from being replayed into the
  attribution via that observer's `{ buffered: true }`.

- **Profile reading — four passes, same recipe
  (`--sizes 3000,30000 --skip-pipeline --skip-dexie`), read `ui.scroll.loaf`
  at mixed/30 000 each time.** The first three (below) were all confounded;
  the fourth, with the settle wait landed, is the clean read:

  | Attribution | pre-finding-2 | post-finding-2 | post-fileOccurrenceMap fixes | post-settle-wait |
  |---|---|---|---|---|
  | `IdleRequestCallback` (`fileOccurrenceMap` warm-up) | 12 760 ms | 12 463 ms | 3 168 ms | *(not in window)* |
  | `IDBRequest.onsuccess` (Dexie cache write from cold start) | 10 871 ms | 9 958 ms | 10 836 ms | *(not in window)* |
  | React commit (`react-dom_client.js`, `MessagePort.onmessage`) | 6 942 ms | 6 881 ms | 7 040 ms | **709–743 ms** |
  | `DIV.onscroll` (TanStack Virtual's own scroll handler) | 1 937 ms | 1 614 ms | 1 644 ms | **1 635–1 667 ms** |
  | style+layout recalc, summed across all LoAF entries | 19.5 ms | 17.4 ms | 18.6 ms | 14.9–15.6 ms |
  | scroll p50 / worst frame interval | 100.1 / 133.3 ms | 83.4 / 216.7 ms | 83.4 / 116.7 ms | 99.9 / 116.7–133.4 ms |
  | settle wait | *(n/a)* | *(n/a)* | *(n/a)* | 0 ms (already quiet) |

  Two runs at the settle-wait column, both mixed/30 000: `DIV.onscroll`
  1 667 ms / 1 635 ms, `MessagePort.onmessage` 743 ms / 709 ms, p50 99.9 ms /
  99.9 ms — stable, not a one-off. At mixed/3 000 the settled reading is
  **0 LoAF frames, 0 ms blocking** on one run and 4 frames/17.6 ms on the
  other — scrolling 3 000 files barely registers at all.

  - **`fileOccurrenceMap`'s fix worked exactly as measured, and the
    settle-wait now excludes both cold-start confounds from the window
    entirely** — they don't taper off, they simply don't appear, because
    `settled.waitedMs: 0` means both were already finished (their own long
    cold-start-load and toggle-flow duration gave them enough wall-clock
    time) by the time the scroll flow's window opens.
  - **The frame interval itself is unchanged from every prior reading**
    (99.9 ms p50 vs. 83.4–100.1 ms across all four passes) — confirming this
    was never about total LoAF-attributed time, which swung by 30×, but
    about what's *inside the measurement window*. The window is now right.
  - **With the window right, the numbers finally add up.** `DIV.onscroll`
    (~1.6 s) + `MessagePort.onmessage` (~0.7–0.75 s) ≈ 2.3–2.4 s of script
    execution across 30 scroll steps ≈ 77–80 ms/step, in the same range as
    the observed 99.9 ms p50 / 116.7–133.4 ms worst. Style+layout recalc
    stays negligible (15–19 ms) at every size in every pass — the
    "measurement rebuild is a layout cost" half of the theory never held,
    but the "measurement rebuild is a *script* cost, proportional to row
    count" half does.
  - **The row-count signature is exact.** Mounted rows hold at 26 for both
    sizes (unchanged), but total row count does not — mixed/3 000 has ~15.7 k
    occurrences in the agenda window against ~163 k at mixed/30 000 (finding
    2's own pipeline numbers). `DIV.onscroll` goes from effectively zero at
    the smaller count to ~1.6 s at the larger one. This is precisely "cost
    proportional to total row count with mounted rows constant" — the
    signature the original suspect predicted and every prior, confounded
    profile could not actually test.

- **Confirmed: TanStack Virtual's measurement rebuild.** Rows are dynamically
  measured — `ref={virtualizer.measureElement}` in
  `src/components/primitives/virtual-rows.tsx:41`. The virtualizer rebuilds
  its `measurements` array from the lowest pending measured index through
  `count` whenever a row measures differently from its `estimateSize`, which
  `useVirtualFlip`'s own doc comment says "happens constantly while scrolling
  through not-yet-measured rows". The settled profile above is direct
  evidence, not inference: `DIV.onscroll` is the single largest attributed
  script at mixed/30 000 once the window is right, its magnitude times 30
  steps lands in the observed frame-interval range, and it disappears at
  mixed/3 000 exactly where row count — not mounted rows, not files — also
  drops by an order of magnitude.

- **Next steps — a fresh decision, not scoped here.** The standard
  mitigations, from the original plan: bounding `count` (the loaded run only
  ever *grows* forward within its ±365/+90-day cap —
  `growAgendaLoadedChunksForward`, `calendar/viewState.ts` — so a sliding
  window that also drops chunks far behind the viewport is the usual answer,
  and `useAgendaChunks` already has the eviction machinery: its commit-phase
  `useEffect` drops chunks outside the requested run, so only the run itself
  needs to shrink) and making each measurement cheaper
  (`content-visibility: auto` plus `contain: layout style paint` on rows).
  **Both are behaviour-visible on a scroll-restore path that has been got
  wrong twice before** (see `computeAgendaScrollRestore`'s own notes) —
  re-tier and scope carefully before starting, this is not a mechanical
  follow-up.

- **Recommended model** — the diagnosis is done and settled by direct
  measurement, which is the hard part; what's left is implementing one of
  two well-understood mitigations against a component with a documented
  history of getting this exact kind of change wrong. Opus 5, and design the
  scroll-restore interaction before writing the fix.
