// Conservative reservation for badge + cell padding, used only to estimate
// how many occurrence rows fit in the remaining cell height — doesn't need to be exact.
const CELL_CHROME = 26
// gap-0.5 between stacked rows — shared with MonthGrid's marginTop calc for
// reserved multiday-bar lanes, since bars and occurrence rows must line up.
export const ROW_GAP = 2

// Panes either side of the current one, kept simultaneously mounted so a rapid
// burst of swipes has somewhere to go before the first has committed and the
// window recentered. Embla caps each swipe to one pane (skipSnaps: false), so
// the extra width buys chaining, not multi-page flings. Must stay odd (a
// well-defined center pane). Shared by both calendar carousels via useCarousel.
//
// Sized at ±5 (rather than the ±2 it started at) so a burst of five rapid
// swipes in a row — see plans/calendar-swipe-cheap-panes.md's PR 2 acceptance
// bar — always has a pane to land on even in the worst case where none of
// them commits (route-navigates) before the next one fires. This is PR 2's
// "prefer the smaller change if it is enough" alternative to giving
// useCarousel its own mid-burst-recentering pane window: raising the buffer
// needs no change to the delicate commit/recenter timing (see useCarousel's
// own header comment), and PR 1 already made the non-center panes cheap
// (skeletons), so mounting more of them costs little. It does not make
// swiping literally unbounded — a burst of six or more swipes with none of
// them committing could still stall — but every measured/expected burst size
// fits comfortably underneath it.
export const PANE_COUNT = 11

/**
 * How many occurrence rows fit in a month cell before falling back to "+N more",
 * derived purely from measured geometry — no ResizeObserver of its own needed
 * per pane, since gridH/rowH are month-independent and measured once by the parent.
 */
export function maxVisibleFor(gridH: number, weekRows: number, rowH: number): number {
  if (!gridH || !rowH || !weekRows) return 3
  const cellH = gridH / weekRows
  const available = cellH - CELL_CHROME
  const n = Math.floor((available + ROW_GAP) / (rowH + ROW_GAP))
  return Math.min(8, Math.max(1, n))
}
