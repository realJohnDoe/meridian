# The agenda's quick-nav swipe — history and open follow-up

All three PRs are done: PR 1 (stopping the agenda's own scroll position from
steering the quick-nav grid — see `src/routes/_app.tsx`'s
`agendaQuickNavAnchor` and `src/routes/_app.test.tsx`), PR 2 (seeding the
agenda's scroll offset instead of reconciling to it — see
`src/calendar/AgendaView.tsx`'s scroll-to-target effect), and PR 3 (the
agenda's quick-nav browse now fires `requestScrollToDate` once per swipe, on
commit only — see `_app.tsx`'s agenda branch of `renderQuickNavPanel`, and the
"one browse per swipe" tests in `_app.test.tsx`). One follow-up is still
open — see "Also worth doing: a gate, or this returns" below.

What remains here is the diagnosis and the traps found along the way, kept as
reference for anyone touching this code next.

**Read the "Two fixes that do not work" section before touching
`requestScrollToDate` or the agenda's quick-nav wiring again.** Both are the
obvious first thing to try, both were measured, and both make it worse.

**Read "What PR 2 actually bought" before trusting the ms figures in "What
is actually slow" below** — they predate PR 1, and a clean re-measurement on
the PR-1-merged codebase does not reproduce the dramatic delta the original
investigation attributed to PR 2's own change in isolation.

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

### ✗ Just dropping the agenda's `onBrowseMonthPreview`, on its own, was never going to be *the* fix

Measured (pre-PR-1/PR-2, at the time this was the only change on the table) at
645 ms busy against a 767 ms baseline, with the *worst frame unchanged*
(370–399 ms). The commit path did the identical work; removing the preview
relocated it rather than removing it — the real fix was PR 2, not this. Landed
anyway, afterward, as cleanup — see "PR 3, for the record" below — since
firing `requestScrollToDate` once instead of twice is a legitimate reduction
in work even once it stopped being load-bearing for the ms number.

---

## What PR 2 actually bought

PR 2 replaced `AgendaView.tsx`'s scroll-to-target effect's
`virtualizer.scrollToIndex(goToRowIndex, { align: 'start' })` with a direct
`scRef.current.scrollTop = offsetOfRow(rows, goToRowIndex, agendaScrollMeasurements)`
write (`offsetOfRow` exported from `computeAgendaScrollRestore.ts`), plus one
bounded corrective `scrollToIndex` pass on the next frame if the seed landed a
row off. Implemented as designed below, and it is unambiguously the more
correct mechanism: one deterministic write plus at most one correction, versus
an unbounded reconciliation loop with no guarantee on how many corrective
passes it takes.

**The ms figure this section originally projected (1 328 ms → 359 ms) does not
hold up.** That number was measured in the same exploratory session that
produced PR 1's prototype, before PR 1's fix was a separate, persisted change
— the "baseline" it was compared against was still carrying PR 1's
anchor-yank-back render cascade, which inflated it. Re-measured cleanly on the
actual PR-1-merged codebase (six repeated swipes each, `GROW=10`, 1 200-file
vault, real touch events, same recipe): baseline (`scrollToIndex`) and PR 2
(seeded offset) come back statistically indistinguishable — both ~535–758 ms
busy in the touchend→+900 ms window, both 8–13 `AgendaView` renders per swipe,
with wide swipe-to-swipe variance in both (57–489 ms worst frame) that reads as
sandbox scheduling noise rather than a structural difference. PR 2's own
`corrections` counter reads 0 across every repeat — the seeded write already
lands on the exact target row every time in this vault, so the corrective path
adds no visible cost of its own.

**Why the delta is small here:** the dominant cost — confirmed by profile, not
inference — is React rendering and the virtualizer measuring however many new
rows a browse brings into view (`jsxDEV`, `addValueToProperties`,
`measureElement`), which PR 2 does not touch and cannot: mounting new content
costs what it costs regardless of how the scroll position that revealed it was
reached. What PR 2 removes is specifically TanStack's own iterative
scroll-measure-correct reconciliation on top of that — real, bounded-not-open-
ended work, but on this vault's occurrence density — dense enough that even a
freshly-reseeded 3-chunk/84-day window carries thousands of rows, confirmed by
instrumenting `useAgendaLoadedRun`/`useAgendaChunks` directly during
verification — it was apparently already converging in about as few corrective
passes as PR 2's own bounded design allows, so there wasn't much reconciliation
cost left to remove once PR 1 stopped the render cascade that was amplifying
it. Most of the original investigation's dramatic win was PR 1's, not PR 2's.

None of this makes PR 2 wrong — it is still a strictly simpler, more bounded
mechanism, consistent with what `computeAgendaScrollRestore.ts` already does
for the mount path, and it may matter more on a vault whose window-local
density is lower (so `scrollToIndex` would otherwise need several corrective
passes to converge) or on a slower device than this sandbox's. It just is not,
on its own, the dramatic fix the original number implied — that credit
belongs to PR 1.

---

## PR 3, for the record: one browse per swipe, not two

`_app.tsx` used to pass `requestScrollToDate` as *both* `onBrowseMonth` and
`onBrowseMonthPreview` for the agenda, on the reasoning that it was "already
cheap (no navigation)". It was not the cheapest of the three views' preview
callbacks — day/week write one string to decoupled preview state on preview;
the agenda's own call moved `agendaAnchor` and re-rendered the agenda's row
list, twice per swipe (preview *and* commit), once of them squarely inside the
snap animation.

Fixed by dropping `onBrowseMonthPreview` on the agenda branch entirely.
`MiniMonth`'s own local `browsePreview` state still keeps the panel's own
`MonthStrip` highlight tracking the gesture live — unaffected, since that is
local to `MiniMonth`, not `calendarView`'s `monthPreview`. **The one
user-visible effect:** the agenda behind the panel no longer live-tracks the
drag — it jumps once, on commit (settle), instead of previewing mid-gesture.
If that live tracking turns out to be missed, the alternative is to keep the
preview call but make it move only the scroll position, never `agendaAnchor`.

Verified via `src/routes/_app.test.tsx`'s "one browse per swipe" tests
(`requestScrollToDate` fires zero times on preview, once on commit — driven
directly through the mocked carousel, the same way
`MiniMonth.preview.test.tsx` drives `onPreview`/`onCommit`). Not re-measured
in a real browser: it is a straight subtraction from an already-cheap call
(see "What PR 2 actually bought" — the pre-PR-3 baseline already had nothing
expensive per individual `requestScrollToDate` call), so it cannot plausibly
regress busy time or render count, only reduce their frequency by roughly half
on the agenda specifically.

---

## Also worth doing: a gate, or this returns

This was the **third** distinct root cause found for one user-visible
symptom, and jsdom has no layout engine and no frame budget — it cannot
observe *cost* directly. `src/calendar/AgendaView.test.tsx` and
`computeAgendaScrollRestore.test.ts` now cover PR 1 and PR 2's *functional*
regressions (an arbitrary quick-nav-browsed day still lands correctly;
`offsetOfRow`'s exported contract is pinned directly), and PR 1's own
`_app.test.tsx` pins the render-count-explosion shape of its specific bug. No
PR here added the *general* gate this section originally proposed — a test
that drives a quick-nav browse and asserts a bound on `AgendaView`'s render
count regardless of which future change might blow it up again (the 8–13
range measured for PR 1+2 together is the number to bound against; 32+ on any
single swipe is the shape a regression takes, per the render-count cascades
found while investigating both PRs). Still worth adding; still not done.

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
