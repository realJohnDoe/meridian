export interface MonthCell {
  date: Date
  /** True for a leading/trailing day borrowed from the adjacent month, so a caller can dim it. */
  other: boolean
}

/**
 * The 7-per-row grid of dates a month view shows for `y`/`m` (`m` 0-indexed)
 * at locale week-start `ws` (0=Sun..6=Sat) — leading/trailing days from the
 * adjacent months included so every row is a full week. Naturally 4-6 rows
 * depending on the month's shape and where it falls against `ws`.
 *
 * Pass `minWeeks` to pad the trailing edge with extra out-of-month rows up to
 * that count (e.g. 6, matching react-day-picker's `fixedWeeks`) for a caller
 * that wants a constant grid height regardless of which month is showing —
 * MiniMonth's quick-nav grid wants that so paging between a 5-row and a
 * 6-row month doesn't jump the panel's height; MonthGrid doesn't, since it
 * measures/reserves row height itself (see `maxVisibleFor`).
 *
 * Extracted from MonthGrid's own pane so MiniMonth's grid can share it rather
 * than re-deriving the same date math — see plans note on avoiding double
 * maintenance between the two month-shaped calendar widgets.
 */
export function monthGridCells(y: number, m: number, ws: number, minWeeks?: number): MonthCell[] {
  const rawFirst = new Date(y, m, 1).getDay()
  const first    = (rawFirst - ws + 7) % 7
  const dim      = new Date(y, m + 1, 0).getDate()
  const prev     = new Date(y, m, 0).getDate()
  let nc         = (7 - (first + dim) % 7) % 7

  if (minWeeks) {
    const rows = (first + dim + nc) / 7
    if (rows < minWeeks) nc += (minWeeks - rows) * 7
  }

  const out: MonthCell[] = []
  for (let i = first - 1; i >= 0; i--)  out.push({ date: new Date(y, m - 1, prev - i), other: true })
  for (let d = 1; d <= dim; d++)         out.push({ date: new Date(y, m, d),             other: false })
  for (let d = 1; d <= nc; d++)          out.push({ date: new Date(y, m + 1, d),          other: true })
  return out
}
