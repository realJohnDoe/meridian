// Conservative reservation for badge + cell padding, used only to estimate
// how many occurrence rows fit in the remaining cell height — doesn't need to be exact.
const CELL_CHROME = 26
// gap-0.5 between stacked rows — shared with MonthGrid's marginTop calc for
// reserved multiday-bar lanes, since bars and occurrence rows must line up.
export const ROW_GAP = 2

/**
 * Resolves a scroll-snap track's scrollLeft to a pane index, or null if the
 * track isn't currently settled on a snap point (mid-drag, or paneW unknown).
 *
 * paneW must come from a fractional measurement (getBoundingClientRect().width),
 * not clientWidth — on a fractional-CSS-px viewport (e.g. 393.5px at 3x DPR),
 * an integer-rounded paneW accumulates enough error by idx 2 to permanently
 * fail a tight tolerance, silently breaking navigation in one direction only
 * on a subset of devices.
 */
export function snapIndex(scrollLeft: number, paneW: number, tolerance = 2): number | null {
  if (!paneW) return null
  const idx = Math.round(scrollLeft / paneW)
  if (Math.abs(scrollLeft - idx * paneW) > tolerance) return null
  return idx
}

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
