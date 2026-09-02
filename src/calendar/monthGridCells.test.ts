import { describe, it, expect } from 'vitest'
import { monthGridCells } from './monthGridCells'

describe('monthGridCells', () => {
  it('pads the leading/trailing edges so every row is a full week, week-start Monday', () => {
    // August 2026: Sat 1 -> Mon 31, week-start Monday (ws=1) -> leading Mon 27..Fri 31 (Jul),
    // trailing Sun 6 (Sep) to complete the last row.
    const cells = monthGridCells(2026, 7, 1)
    expect(cells.length % 7).toBe(0)
    expect(cells[0]).toEqual({ date: new Date(2026, 6, 27), other: true })
    expect(cells.at(-1)).toEqual({ date: new Date(2026, 8, 6), other: true })
    const inMonth = cells.filter(c => !c.other)
    expect(inMonth).toHaveLength(31)
    expect(inMonth[0]!.date).toEqual(new Date(2026, 7, 1))
    expect(inMonth.at(-1)!.date).toEqual(new Date(2026, 7, 31))
  })

  it('shifts the leading edge for a different week-start', () => {
    // Same month, week-start Sunday (ws=0): Aug 1 2026 is a Saturday (weekday
    // index 6), so the leading run is the full Sun..Fri before it, 6 days
    // starting Jul 26 — one day more than the Monday-start case above.
    const cells = monthGridCells(2026, 7, 0)
    expect(cells[0]!.date).toEqual(new Date(2026, 6, 26))
    expect(cells[0]!.other).toBe(true)
  })

  it('needs no padding for a month that already fills whole weeks (natural row count)', () => {
    // February 2026 starts on a Sunday and has 28 days -> exactly 4 rows with ws=0.
    const cells = monthGridCells(2026, 1, 0)
    expect(cells).toHaveLength(28)
    expect(cells.every(c => !c.other)).toBe(true)
  })

  it('leaves a month whose natural row count already meets minWeeks untouched', () => {
    const natural = monthGridCells(2026, 7, 1)
    const padded = monthGridCells(2026, 7, 1, natural.length / 7)
    expect(padded).toEqual(natural)
  })

  it('pads a short month up to minWeeks extra trailing rows', () => {
    // February 2026, ws=0: natural is 4 rows (28 cells, see above). Padding to
    // 6 rows adds 2 more weeks (14 cells) of trailing March days.
    const cells = monthGridCells(2026, 1, 0, 6)
    expect(cells).toHaveLength(42)
    expect(cells.slice(28).every(c => c.other)).toBe(true)
    expect(cells[28]!.date).toEqual(new Date(2026, 2, 1))
    expect(cells.at(-1)!.date).toEqual(new Date(2026, 2, 14))
  })

  it("doesn't pad when minWeeks is already met or exceeded by the natural grid", () => {
    // August 2026 ws=1 is naturally 6 rows (see the first test) — asking for
    // 5 must not shrink it.
    const natural = monthGridCells(2026, 7, 1)
    expect(monthGridCells(2026, 7, 1, 5)).toEqual(natural)
  })
})
