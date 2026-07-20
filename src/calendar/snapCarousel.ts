// Conservative reservation for badge + cell padding, used only to estimate
// how many occurrence rows fit in the remaining cell height — doesn't need to be exact.
const CELL_CHROME = 26
// gap-0.5 between stacked rows — shared with MonthGrid's marginTop calc for
// reserved multiday-bar lanes, since bars and occurrence rows must line up.
export const ROW_GAP = 2

// Panes either side of the current one, kept simultaneously mounted so a rapid
// second swipe has somewhere to go before the first has committed and the
// window recentered. Embla caps each swipe to one pane (skipSnaps: false), so
// the extra width buys chaining, not multi-page flings. Must stay odd (a
// well-defined center pane). Shared by both calendar carousels via useCarousel.
export const PANE_COUNT = 5

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
