# The agenda's quick-nav swipe — implementation plan

Two PRs remaining. PR 1 (stopping the agenda's own scroll position from
steering the quick-nav grid) is done — see `src/routes/_app.tsx`'s
`agendaQuickNavAnchor` and `src/routes/_app.test.tsx`. PR 2 is the one that
matters and it is a contained change to one layout effect; PR 1 was a
prerequisite because without it, PR 2's acceptance test would have silently
lied. PR 3 is small and optional.

**Read the "Two fixes that do not work" section before starting.** Both are
the obvious first thing to try, both were measured, and both make it worse.

---

## What is actually slow

Measured on the dev server (the large-vault generator is dev-only), Chromium
141, 412×915, `hasTouch`, unthrottled, 1 200-file generated vault, real touch
events via CDP. The window is **touchend → +900 ms**. Absolute ms carry
dev-React overhead — compare columns, not against a shipped budget. Recipe at
the bottom.

| view | busy | worst frame | long tasks/swipe |
|---|---|---|---|
| **agenda** | **698–767 ms** | **373–409 ms** | **3** |
| week | 392–399 ms | 159–204 ms | 2 |
| day | 278–323 ms | 95–127 ms | 1 |

Agenda scales with vault size where day does not (day is DOM-proportional and
PR1 of `calendar-swipe-cheap-panes.md` already fixed that axis):

| vault | agenda busy / worst | day busy / worst |
|---|---|---|
| 300 | 555 ms / 300 ms | 205 ms / 92 ms |
| 1 200 | 698 ms / 373 ms | 278 ms / 95 ms |
| 3 000 | **1 389 ms / 855 ms** | 296 ms / 142 ms |

The cost is **not** occurrence expansion and **not** row assembly. Instrumented
on a grown loaded run, one swipe produces:

```
rows in the list          6 460
goToRowIndex              ~3 400      <- the scroll crosses ~3 400 rows
virtualizer.scrollToIndex 2           <- once on preview, once on commit
AgendaView renders        8–11
```

`AgendaView.tsx`'s layout effect calls
`virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })` across thousands
of rows whose sizes are mostly *estimates* (`ROW_H_PLAIN` 50 vs a measured 68).
TanStack Virtual reaches such a target iteratively — scroll, measure, correct,
re-scroll — and each correction re-renders `AgendaView`, which carries
`'use no memo'` for the virtualizer and therefore re-runs its whole body. The
profile is dominated by `jsxDEV`, `addValueToProperties`, `createElement`,
`measureElement` — React and the virtualizer, not `model/`.

`computeAgendaScrollRestore.ts` already documents this exact cost for the mount
path and already solves it there:

> Starting at 0 meant the first painted frame showed the oldest day in the
> window, and the correction that followed cost a full unmount/remount of the
> viewport (traced at 66 ms […]) plus a round of TanStack's rAF scroll
> reconciliation.

…and it names the one case it cannot cover:

> The case it still carries on its own is the Today button (or a sidebar jump)
> pressed while the agenda is already mounted, where there is no new mount and
> therefore no `initialOffset` to seed.

A quick-nav browse is that case, fired twice per swipe, inside the snap
animation. **The fix is to give the already-mounted path the same seeded-offset
treatment the mount path gets.**

---

## Two fixes that do not work

Both were implemented and measured. Do not re-attempt them; if a future change
seems to call for one, re-measure first.

### ✗ Don't null `agendaLoadedChunks` in `requestScrollToDate`

The tempting one-liner. `requestScrollToDate` currently does:

```ts
calendarView.setState({ agendaAnchor: dateKey, agendaScrollTarget: dateKey, agendaLoadedChunks: null })
```

Nulling the run reseeds it to three chunks and evicts cached chunks, which
looks like pure waste. It is not: **the reseed is also what keeps the scroll
short.** It shrinks `rows` and re-centres the run on the anchor, so
`scrollToIndex` has a few hundred rows to cross instead of several thousand.

Removing it — in either the "keep the run" or the "extend the run to cover the
anchor" form — measured, on a grown run:

| | busy | AgendaView renders per swipe |
|---|---|---|
| baseline | 1 328 ms | 8 → 11 → 11 |
| reseed removed | **4 260 ms** | 9 → 32 → **110** |

Leave `requestScrollToDate` alone. The same reasoning retires the related idea
of taking `anchorMs` out of `computeAgendaSections`' `assemblyReusable` gate:
row assembly is not where the time goes.

### ✗ Just drop the agenda's `onBrowseMonthPreview`

Measured at 645 ms busy against a 767 ms baseline, with the *worst frame
unchanged* (370–399 ms). The commit path does the identical work; removing the
preview relocates it rather than removing it. Worth doing (PR 3) but only as
cleanup on top of PR 2, never as the fix.

---

## PR 2 — Seed the agenda's scroll offset instead of reconciling to it

**The fix.** Measured on a grown run, baseline vs. prototype:

| | busy | worst frame | long tasks |
|---|---|---|---|
| baseline | 1 328 ms | 470–659 ms | 3 |
| seeded offset | **359 ms** | **92–201 ms** | 1–3 |

### The change

`src/calendar/AgendaView.tsx`, the scroll layout effect (~line 231):

```ts
useLayoutEffect(() => {
  if (!scrollTarget || goToRowIndex < 0 || !scRef.current) return
  virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })   // <- this
  lastTopRef.current = scrollTarget
  anchorAt(goToRowIndex, scrollTarget)
  markAgendaScrolled(scrollTarget)
}, [scrollTarget, goToRowIndex, virtualizer, anchorAt])
```

Replace the `scrollToIndex` with a direct offset write, computed by the function
the mount path already uses:

```ts
scRef.current.scrollTop = offsetOfRow(rows, goToRowIndex, agendaScrollMeasurements)
```

`offsetOfRow` lives in `src/calendar/computeAgendaScrollRestore.ts` and is
currently module-private — export it. It sums measured sizes where the snapshot
has them and `estimateRow` elsewhere, which is exactly the arithmetic the
virtualizer would otherwise arrive at iteratively. One write, one scroll event,
no reconciliation loop.

### The trap this creates, and what to do about it

A summed offset is **not exact** where rows are unmeasured, so the landing row
can be off by one. That is the off-by-one that broke navigation in the
prototype before PR 1 landed (the feedback loop through `anchorMonth` — see
`src/routes/_app.tsx`'s `agendaQuickNavAnchor`). PR 1 already removes the
catastrophic consequence; this PR should also correct the landing itself:

- After the seeded write, on the **next frame only**, check whether the row at
  the top is `goToRowIndex`; if not, issue a single
  `virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })`. Starting a few
  pixels out, that converges immediately — the same argument
  `computeAgendaScrollRestore`'s doc already makes for the mount path ("the seed
  is still only an estimate on a cold start, so AgendaView keeps a corrective
  scrollToIndex — but it now starts from a few pixels out instead of a year").
- Do **not** make the correction unconditional or recursive; one bounded pass.

`lastTopRef` / `anchorAt` / `markAgendaScrolled` keep their current order — they
record the *intended* target, which is still correct.

### Files
- `src/calendar/AgendaView.tsx` (the one layout effect)
- `src/calendar/computeAgendaScrollRestore.ts` (export `offsetOfRow`)
- `src/calendar/AgendaView.test.tsx`, `src/calendar/computeAgendaScrollRestore.test.ts`

### Watch out
- **jsdom has no layout engine**, so `scrollTop` writes and `measureElement` are
  both inert there. Existing AgendaView tests assert on `scrollToIndex` being
  called — some will need to assert on the seeded offset instead. Do not "fix" a
  failing test by reinstating the unconditional `scrollToIndex`.
- `useVirtualFlip` is armed by a `rows` identity change and skipped while
  `isScrolling`. A seeded write is a single synchronous scroll, so
  `virtualizer.isScrolling` may read `false` where it used to read `true` —
  check that a browse does not now trigger a full-list glide animation.
- Do not touch `requestScrollToDate` (see "Two fixes that do not work").

### Acceptance
- Re-run the recipe below **with a grown run** (`GROW` step — scroll the agenda
  to the end ~10 times before opening the panel). A narrow 3-chunk run hides the
  entire bug; measuring only the fresh-mount state is how this was missed before.
- Target: busy < 400 ms and worst frame < 250 ms at 1 200 files, against the
  1 328 ms / 470–659 ms baseline.
- `AgendaView` renders per swipe must not exceed the current 8–11.
- Sanity-check the Today button and the sidebar Agenda jump by hand — they go
  through the same effect.

---

## PR 3 — One browse per swipe, not two (optional, small)

`_app.tsx` passes `requestScrollToDate` as *both* `onBrowseMonth` and
`onBrowseMonthPreview` for the agenda, on this reasoning:

```tsx
// Already cheap (no navigation) — same call on preview as on commit.
onBrowseMonthPreview={d => requestScrollToDate(fmtISO(d))}
```

"No navigation" is not "cheap" — it is the most expensive of the three views'
preview callbacks. Preview fires on Embla's `select` (finger lift, animation
starting) and commit on `settle` (animation done), so the agenda re-targets
twice per swipe, once of them squarely inside the snap animation.

After PR 2 each call is cheap, so this is cleanup rather than the fix. Drop
`onBrowseMonthPreview` on the agenda branch. `MiniMonth`'s own `browsePreview`
state keeps the panel's `MonthStrip` highlight tracking the gesture without it —
that is local state, unrelated to `calendarView`'s `monthPreview`.

**This is a user-visible behaviour change** (the agenda behind the panel stops
tracking mid-gesture and lands on commit instead), which is why it is its own
PR rather than folded into PR 2. If that tracking is wanted, the alternative is
to keep the preview but make it move only the scroll position, never the anchor.

### Acceptance
- `requestScrollToDate` fires **once** per swipe (spy on it, drive
  `onPreview`/`onCommit` the way `MiniMonth.preview.test.tsx` already does).
- Re-measure; it should be at or below PR 2's number, never above.

---

## Also worth doing: a gate, or this returns

This is the **third** distinct root cause found for one user-visible symptom,
and nothing in `src/` can see any of them — jsdom has no layout engine and no
frame budget, and `MiniMonth.preview.test.tsx` pins the *order* of
preview/commit but not their cost.

Cheapest useful gate, no browser needed: a test that drives a quick-nav browse
and asserts a **bound on `scrollToIndex` calls and on `AgendaView` render
count**. Both were the actual regression signal here (8–11 renders healthy, 110
broken), both are observable in jsdom, and both are stable numbers.

Add it in whichever PR lands first that makes it pass.

---

## Reproducing the measurement

Not committed as a script — `scripts/perf/` is already under an expiry notice
(see `plans/vault-scaling-results.md`). The recipe is the artefact.

1. `pnpm exec vite --port 5201 --strictPort` — the **dev** server.
   `meridian_bigvault` is gated on `import.meta.env.DEV`, and `vite build` sets
   `DEV=false` whatever `--mode` says, so a built bundle cannot carry the
   generator.
2. Playwright at `viewport 412×915`, `hasTouch`, `isMobile`. `addInitScript`
   setting `meridian_bigvault` (`'1200'`) and `meridian_locale_prefs`
   (`{hour12:false, firstDayOfWeek:1}`), plus a rAF loop recording
   `[timestamp, delta]` pairs and a `longtask` PerformanceObserver.
3. Load `/meridian/`, then **wait for quiet** — no long task for 1.5 s — or the
   vault parse/expand is still running and contaminates everything.
4. **Grow the loaded run** before measuring: scroll the agenda's
   `.overflow-y-auto` container to `scrollHeight` ~10 times, 450 ms apart, then
   settle mid-list. Skipping this measures a 3-chunk run and hides the bug.
5. Click `[aria-controls="quickNavPanel"]`. Find the **on-screen**
   `#quickNavPanel [data-slot="calendar"]` — the buffer panes sit at negative x
   and dragging one measures nothing.
6. Drive the drag with CDP `Input.dispatchTouchEvent`. Embla 8 listens for
   `touchstart`/`touchmove`/`touchend` and `mousedown`/`mousemove`/`mouseup`,
   **not** pointer events — synthetic `PointerEvent`s are silently ignored and
   the swipe appears free.
7. Cut the frame log to `[touchend, touchend + 900 ms]`. Take **3–4 swipes per
   run and read swipes 2+**: the first swipe from a fresh panel is not
   representative, and the runaway cases only appear from the second onward.
8. Useful probes while iterating (temporary, not committed): a counter in
   `AgendaView`'s body (renders), one at the `scrollToIndex` call, and
   `goToRowIndex` / `rows.length` read at the end of the window.
