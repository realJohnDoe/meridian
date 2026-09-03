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
| 6 | 4 | Scroll cost grows with vault size although mounted rows stay constant | 7 | 2 | **Sonnet 5** for the instrumentation; re-tier once it reads |

This is Sonnet-5 work **as written**, and only as written — strip the named
tests and the ruled-out-suspects context and it reverts to Opus 5.

Finding 4 has no settled diagnosis yet, so its block is an *instrumentation*
plan: it says what has already been ruled out, what the one matching suspect
is, and how to attribute the frame time automatically — and it deliberately
stops short of a fix. Do not skip to step 4 of it.

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
