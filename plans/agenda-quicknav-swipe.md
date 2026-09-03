# The agenda's quick-nav swipe — history and open follow-up

PR 1 is done — see `src/routes/_app.tsx`'s `agendaQuickNavAnchor` and
`src/routes/_app.test.tsx`. **PR 2 was implemented, shipped, found to cause a
real production regression (the Today button drifting to the wrong day on
repeated presses, and the cold-start landing itself off by several rows), and
reverted** — see "PR 2 — implemented, shipped, reverted" below, now required
reading before anyone re-attempts a seeded-offset approach to this effect.
PR 3 is done too — the agenda's quick-nav browse now fires
`requestScrollToDate` once per swipe, on commit only (see `_app.tsx`'s agenda
branch of `renderQuickNavPanel`, and the "one browse per swipe" tests in
`_app.test.tsx`). One further follow-up is still outstanding — see "Also
worth doing: a gate, or this returns" below.

What remains here is the diagnosis and the traps found along the way,
including PR 2's own trap, kept as reference for anyone touching this code
next.

**Read "Three fixes that do not work" before touching `requestScrollToDate`,
`AgendaView`'s scroll-to-target effect, or the agenda's quick-nav wiring
again.** All three were the obvious next thing to try, all three were
implemented and measured (one of them shipped before its bug surfaced), and
all three make it worse.

**Read "What PR 2 actually bought" before trusting the ms figures in "What is
actually slow" below** — they predate PR 1, and a clean re-measurement on the
PR-1-merged codebase does not reproduce the dramatic delta the original
investigation attributed to PR 2's own change in isolation. That weak
performance case is itself part of why reverting was the right call once the
correctness bug surfaced, rather than a third attempt at patching the same
mechanism.

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
the calendar carousel's cheap-panes work already fixed that axis — DayPane/
WeekPane's `live` prop, only the centre pane renders interactive cells):

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
animation. This read as an invitation to give the already-mounted path the
same seeded-offset treatment the mount path gets — see why that doesn't work
below, twice over.

---

## Three fixes that do not work

All three were implemented and measured (the third shipped and had to be
reverted). Do not re-attempt any of them; if a future change seems to call
for one, re-measure — and re-read "PR 2 — implemented, shipped, reverted" —
first.

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

### ✗ Just dropping the agenda's `onBrowseMonthPreview`, on its own, was never going to be *the* fix

Measured (pre-PR-1/PR-2, at the time this was the only change on the table) at
645 ms busy against a 767 ms baseline, with the *worst frame unchanged*
(370–399 ms). The commit path did the identical work; removing the preview
relocated it rather than removing it — the real fix, it seemed at the time,
was PR 2. Landed anyway, afterward, as cleanup (`#913`) — dropping the
agenda's `onBrowseMonthPreview` entirely, firing `requestScrollToDate` once
per swipe instead of twice — since that's a legitimate reduction in work
independent of whatever PR 2 did or didn't buy. See `_app.tsx`'s agenda
branch of `renderQuickNavPanel`, and the "one browse per swipe" tests in
`_app.test.tsx`.

### ✗ Seeding `AgendaView`'s scroll-to-target effect directly, instead of `scrollToIndex`

This is PR 2. It shipped. It broke the Today button and the cold-start
landing. Reverted. Full account in "PR 2 — implemented, shipped, reverted"
below — read it before trying any variant of this again, including the
`virtualizer.takeSnapshot()` variant that fixes the *first* of the two bugs
found and not the second.

---

## PR 2 — implemented, shipped, reverted

### What it was

Replaced `AgendaView.tsx`'s scroll-to-target effect's
`virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })` with a direct
`scRef.current.scrollTop = offsetOfRow(rows, goToRowIndex, agendaScrollMeasurements)`
write (`offsetOfRow` exported from `computeAgendaScrollRestore.ts`, still
exported and still used by that file's own mount-time seed — only
`AgendaView.tsx`'s import of it was reverted), plus one bounded corrective
`scrollToIndex` pass on the next frame if the seed landed a row off. Merged as
`#911`.

### The regression report, and confirming it

A user reported the Today button "drifting" on repeated presses, and the
cold-start landing being affected too. Reproduced directly (dev server, real
touch/click via CDP, a 300-file generated vault): pre-PR-2, five consecutive
Today presses land on the identical row every time (`scrollTop` 45996,
`h|__overdue__`) and the cold-start mount already lands there too. Post-PR-2,
the very first press lands on a *different* row two days early (missing the
overdue header entirely), and it never self-corrects — cold start was already
off before any press.

### Two distinct, compounding bugs — not one

1. **`agendaScrollMeasurements` is written only on unmount** (see
   `useSaveAgendaScroll`) — during a live session it is stale, or (on a
   session's first mount) empty. Summing against it lands on the wrong row,
   and every subsequent press sums against the *same* stale snapshot instead
   of converging — which is what read as unbounded drift rather than a single
   one-off miss.

   Switching the seed's data source to `virtualizer.takeSnapshot()` (the
   virtualizer's own live, continuously-updated measurement cache) fixes this
   half cleanly — verified directly: five presses land on the identical
   correct row, matching the pre-PR-2 baseline exactly.

2. **The bounded corrective pass can be silently cancelled.** Even with
   `takeSnapshot()`, the cold-start case was still landing several rows off.
   Traced by instrumenting every scroll write with a timestamp: on cold
   mount, the effect's own `useLayoutEffect` cleanup
   (`return () => cancelAnimationFrame(raf)`) fires because `rows` is one of
   the effect's dependencies and a background vault sync landing more content
   routinely changes `rows` within the first frame or two after mount —
   cancelling the scheduled correction before it ever runs. By then
   `agendaScrollTarget` has already been cleared (`markAgendaScrolled`,
   called synchronously inside the same effect invocation before the
   correction is even scheduled), so the effect's own guard
   (`if (!scrollTarget || ...) return`) prevents it from ever re-arming.
   `useAnchoredAgendaScroll`'s own, separate, pre-existing "hold position"
   mechanism (see that file — it exists specifically to re-pin the viewport
   when `rows` changes for reasons other than scrolling) then takes over from
   wherever the *uncorrected* estimate-only write landed, not from the true
   target — landing on neither.

Both were confirmed by direct reproduction, not by inference: see
"Reproducing the drift" below for the recipe. The `virtualizer.takeSnapshot()`
patch was implemented and verified to fix bug 1 in isolation, then discarded
along with the rest of the mechanism once bug 2 confirmed the interaction
with `useAnchoredAgendaScroll` was a structural hazard, not a one-off
oversight — `scrollToIndex` drives virtual-core's own `reconcileScroll`,
which re-resolves the target from the index on every frame until stable, so a
`rows` change mid-reconciliation is exactly the case *it* is built to
survive, in a way a single bounded `requestAnimationFrame` pass fundamentally
is not.

### The fix

Full revert: `AgendaView.tsx`'s scroll-to-target effect is back to
`virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })`, with a detailed
comment on that effect recording both bugs so nobody re-attempts this without
reading it first. `offsetOfRow`'s export from `computeAgendaScrollRestore.ts`
was kept (still used by, and unit-tested against, that file's own mount-time
seed — untouched and unaffected by any of this).

### Regression test

`src/calendar/AgendaView.test.tsx`: `'lands on the same offset regardless of
what the store's scroll-measurement snapshot claims'` — poisons
`agendaScrollMeasurements` with this session's own real row keys paired with
sizes an order of magnitude too large (keys that don't exist at all silently
fall back to `estimateRow`, which in this test file's harness is *exactly*
accurate by design — see `estimatedRowHeight`'s own comment — so they
wouldn't exercise the bug), then asserts the Today button still lands on the
same offset as an unpoisoned reference run. Confirmed red against the
`#911`-shipped mechanism (`scrollTop` 42408 vs. the correct 2912) and green
after the revert. Catches bug 1 directly in jsdom; bug 2 (the
background-sync race) needed the real-browser repro and has no jsdom
equivalent — see "Also worth doing" below.

### Reproducing the drift

Real browser, not jsdom (jsdom's `scrollTop` has no real layout to drift
against). Dev server, `meridian_bigvault` set via `localStorage`,
`hasTouch`/CDP click on the Today button (`aria-label="Today"`):

1. Load `/meridian/`, wait for `[data-index]`, let it settle (~2 s — vault
   parse/expand still running otherwise contaminates the read).
2. Record the top visible row (`document.querySelectorAll('[data-flip-key]')`,
   the first one whose bottom edge clears the scroll container's own top
   edge) and `scrollTop`.
3. Scroll away (`el.scrollTop = el.scrollHeight * 0.6`), settle.
4. Click Today 5 times, ~700 ms apart, recording the top row + `scrollTop`
   after each press.

Healthy: every reading (including the cold-start one from step 2) is
identical. Broken: the first post-#911 press already differs from the
cold-start reading, and none of the five presses match each other or settle.

---

## What PR 2 actually bought

Kept for the record — this is *why* the revert cost nothing worth
re-litigating, not a reason to reconsider it.

PR 2's own ms figure (1 328 ms → 359 ms) never held up under clean
re-measurement. That number was measured in the same exploratory session
that produced PR 1's prototype, before PR 1's fix was a separate, persisted
change — the "baseline" it was compared against was still carrying PR 1's
own anchor-yank-back render cascade, which inflated it. Re-measured cleanly
on the actual PR-1-merged codebase (six repeated swipes each, `GROW=10`,
1 200-file vault, real touch events, same recipe): baseline (`scrollToIndex`)
and PR 2 (seeded offset) came back statistically indistinguishable — both
~535–758 ms busy in the touchend→+900 ms window, both 8–13 `AgendaView`
renders per swipe, with wide swipe-to-swipe variance in both (57–489 ms worst
frame) that read as sandbox scheduling noise rather than a structural
difference.

Why the delta was small: the dominant cost — confirmed by profile, not
inference — is React rendering and the virtualizer measuring however many new
rows a browse brings into view (`jsxDEV`, `addValueToProperties`,
`measureElement`), which no scroll-seeding strategy touches or can touch:
mounting new content costs what it costs regardless of how the scroll
position that revealed it was reached. What PR 2 removed was specifically
TanStack's own iterative scroll-measure-correct reconciliation on top of
that — real, bounded-not-open-ended work, but on this vault's occurrence
density (dense enough that even a freshly-reseeded 3-chunk/84-day window
carries thousands of rows) it was apparently already converging in about as
few corrective passes as PR 2's own design allowed for, so there wasn't much
reconciliation cost left to remove once PR 1 stopped the render cascade that
was amplifying it. Most of the original investigation's dramatic win was
PR 1's, not PR 2's — and PR 2 then cost a shipped regression on top of buying
nothing. Not worth a second attempt without a materially different approach
to the two bugs above, and a real vault whose window-local density is low
enough to make the reconciliation cost worth removing in the first place.

---

## Also worth doing: a gate, or this returns

This is now the **fourth** distinct root cause found for this general area (a
fifth if PR 2's two bugs are counted separately), and jsdom has no layout
engine and no frame budget — it cannot observe *cost* directly, and a good
half of PR 2's own bugs (the background-sync race) had no jsdom equivalent at
all and needed a real-browser repro to find. What jsdom testing exists:
`src/calendar/AgendaView.test.tsx` and `computeAgendaScrollRestore.test.ts`
cover PR 1's and PR 2's *functional* regressions (an arbitrary quick-nav-
browsed day still lands correctly; the store-snapshot-poisoning regression
test above; `offsetOfRow`'s exported contract pinned directly), and PR 1's own
`_app.test.tsx` pins the render-count-explosion shape of its specific bug. No
PR here added the *general* gate originally proposed — a test that drives a
quick-nav browse and asserts a bound on `AgendaView`'s render count regardless
of which future change might blow it up again (the 8–13 range measured for
PR 1 alone, now that PR 2 is reverted, is the number to bound against; 32+ on
any single swipe is the shape a render-count regression takes, per the
cascades found while investigating both PRs). Still worth adding; still not
done.

---

## Reproducing the swipe-performance measurement

Not committed as a script — `scripts/perf/` is already under an expiry notice
(see `plans/vault-scaling-results.md`). The recipe is the artefact. (See
"Reproducing the drift" above for the separate, simpler recipe that catches
PR 2's correctness bug rather than measuring swipe performance.)

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
