# Cheap carousel panes, then unbounded swiping

Two PRs, both landed. The first made a day/week pane cheap to mount. The
second spent that headroom on letting a swipe burst run past the pane
window, by raising `PANE_COUNT` (see the constant's own comment in
`snapCarousel.ts`) rather than giving `useCarousel` its own mid-burst
pane-recentering state: the latter would need to force Embla's scroll
position back to center while a snap animation is still in flight, which
needs frame-capture verification on a real touch device that wasn't
available when this was implemented. `PANE_COUNT` is a buffer, not
literally unbounded — a burst larger than it (with none of its swipes
committing in between) can still stall — so revisit the mid-burst design if
that turns out to matter in practice.

## Context: what was measured, and what is already fixed

The "short freeze when swiping the mini calendar" was chased twice on the
wrong theory (PR #889, PR #892 — both assumed occurrence expansion was the
cost). A CPU profile of the actual gesture (CDP sampling profiler, 412×915
viewport, 4× CPU throttle, week view) settled it. Occurrence expansion is
**~3% of the frame**. The real budget, before any fixes:

| | self time |
|---|---|
| `formatHourBoundary` | 754 ms |
| `hourAriaLabel` → `fmtShort` | 736 ms |
| `MonthStrip` chip labels | 276 ms |
| `(program)` — style/layout | 846 ms |
| all of `model/` (expansion) | ~100 ms |

PR #893 (merged) removed the three `Intl` items by memoising and hoisting
them: worst frame **1248 ms → 446 ms**, busy **3607 ms → 1318 ms** on a 24h
clock. Nothing below re-treads that ground.

What is left is the `(program)` line — style and layout for the DOM a pane
window builds:

```
DOM after a mini-calendar jump in week view:
  1924 elements total, 1104 buttons, 840 of them hour cells
```

840 = 7 day columns × `HOURS` (24) × `PANE_COUNT` (5). Every pane-window
change rebuilds all of it synchronously. That is the whole remaining freeze,
and it is independent of clock format, locale and vault size.

The same number is why you cannot swipe more than two panes quickly:
`PANE_COUNT` is 5 (centre ± 2) and cannot be raised while a pane costs this
much.

## The idea, and the two corrections it needs

The proposal — *let swiping run freely over arbitrarily many panes, render
skeletons, fill real content in behind* — is the right shape. Two corrections,
both learned the hard way:

**1. A skeleton has to be cheap in DOM, not just in data.** PR #892 already
built a "defer the data" version of this (`useReadyAfterMount` +
`EMPTY_EXPANSION_WINDOW`, both still in `src/calendar/`) and it bought
essentially nothing, because the data was 3% of the cost. A skeleton pane
that still renders 168 hour-cell buttons costs the same as a real one. The
split therefore is **not** "chrome vs. data" — the expensive thing *is*
chrome. It is "painted grid vs. interactive cells + events".

**2. Exactly one pane may be live at a time.** If every pane upgrades itself
shortly after mounting, the freeze is reproduced N times over instead of
once. React cannot time-slice inside a single component's render or commit,
so deferring work only helps if the deferred work is *small*, not merely
*later*. The invariant must be: the centre pane is live, every other pane is
a skeleton, and a pane is upgraded when it becomes centre (on settle, when
nothing is animating).

With those, the proposal subsumes the "per-cell elements, centre pane only"
option discussed earlier; the CSS-gradient option becomes a fallback for the
skeleton's own painting if step 1's numbers come up short.

---

## How to measure

Nothing in `src/` can see this class of bug: jsdom has no layout engine, and
`test-utils` pins `hour12: false`, which is what hid the `formatHourBoundary`
cost from every unit test. Measure in a real browser.

Recipe (a scratch script, not committed — build first with
`pnpm exec vite build --minify false` so profile frames carry real names):

1. `vite preview`, then Playwright at `viewport 412×915`, `hasTouch`, and
   `Emulation.setCPUThrottlingRate { rate: 4 }` via CDP.
2. `page.addInitScript` writing `meridian_locale_prefs`
   (`{ hour12: false, firstDayOfWeek: 1 }`) so the run pins a known clock.
3. Load `/meridian/week/<date>`, click `[aria-controls="quickNavPanel"]`,
   wait, then find the **on-screen** mini-month pane — querying
   `#quickNavPanel [data-slot="calendar"]` returns the off-screen buffer pane
   first (`x: -412`), and a drag there measures nothing.
4. `Profiler.start` / `Profiler.stop` around a `page.mouse` drag across that
   pane; aggregate `profile.samples` by `callFrame.functionName` for self
   time. Add a `requestAnimationFrame` loop recording inter-frame gaps — the
   worst gap is the number that corresponds to the reported freeze.

Baselines to compare against, same script, 24h clock: worst frame 446 ms,
busy 1318 ms, 840 hour cells.

## Out of scope

- `MonthGrid` — a month pane is 42 day cells, not 168 buttons; it does not
  carry this cost and should be left alone in both PRs.
- The agenda view's virtualizer, which already windows its own rows.
- Reworking the route-as-source-of-truth design — the route stays the pane
  window's only source of truth; PR 2 widened the buffer instead of giving
  the carousel its own competing recentering state.
