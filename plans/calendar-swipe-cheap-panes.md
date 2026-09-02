# Cheap carousel panes, then unbounded swiping

Two PRs. The first (making a day/week pane cheap to mount) has landed; what
remains is the second, which spends that headroom on letting a swipe burst
run past the pane window — only affordable now that the first has landed.

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
much — see PR 2.

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

## PR 2 — Let a swipe burst run past the pane window

**Goal:** rapid repeated swipes keep going instead of stopping at ±2 panes.

### Why it is blocked today

`src/calendar/useCarousel.ts` advances its pane window only at *commit*, and
commit fires on Embla's `settle` (or `COMMIT_FALLBACK_MS`, 500 ms). During a
continuous burst `settle` never fires, so the window never recenters, so the
user runs out of panes at the edge of `PANE_COUNT`. Committing is also a
route navigation (`onCommit` → `navigate`), i.e. a whole-app re-render — too
heavy to run per swipe in a burst.

### Approach

Split "which panes exist" from "what the URL says":

- Give `useCarousel` its own centre-unit state, advanced on Embla's `select`
  (fires the moment a target locks in, mid-animation). The pane window
  follows this immediately, so the buffer refills during a burst and the
  gesture never runs out of slides.
- Keep the **route** commit where it is — on `settle` / the fallback timer —
  so the router still sees one navigation per gesture, not one per swipe.
  The route remains the source of truth for a cold load and for everything
  outside the carousel; it is just allowed to lag the gesture.
- The existing recenter seam (`reInit` + `scrollTo(center, true)` in a layout
  effect) currently relies on "the committed pane was already centred at
  commit time", which stops being true once the window advances
  mid-animation. Advancing the window must therefore keep the *currently
  animating* pane at its current visual position — i.e. shift keys and
  scroll position together so nothing moves on screen. This is the delicate
  part of the PR and deserves its own test.

With panes cheap (PR 1), `PANE_COUNT` can also simply be raised — try 9 —
which widens the burst headroom on its own and is worth measuring *before*
attempting the state split, in case it is enough in practice. Prefer the
smaller change if it is.

Embla's own `loop: true` is the other way to get genuinely unbounded
swiping, but it repositions slide DOM itself and would fight the keyed-pane
reconciliation the views depend on. Not recommended without a spike.

### Files

- `src/calendar/useCarousel.ts` (the whole of it), `src/calendar/snapCarousel.ts`
  (`PANE_COUNT`)
- `src/calendar/DayView.tsx`, `WeekView.tsx`, `MonthView.tsx` — consumers
- `src/calendar/MiniMonth.tsx` — has its own local `PANE_COUNT = 3` and the
  same `useCarousel`; check the change holds there too
- `src/calendar/useCarousel`-adjacent tests, `MiniMonth.preview.test.tsx`
  (drives `onPreview`/`onCommit` directly and pins their relative order)

### Acceptance

- Five rapid swipes in a row advance five units, with no stall at ±2.
- The route still receives one navigation per gesture, not one per swipe
  (assert on a mocked `navigate` in a unit test).
- No visible jump when the window advances mid-animation — verify by frame
  capture, not by reasoning.

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
- Reworking the route-as-source-of-truth design beyond the narrow split
  described in PR 2.
