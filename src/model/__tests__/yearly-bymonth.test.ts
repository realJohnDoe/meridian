import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { Repeat, StoreSeries, Roots } from '@/types'
import { keyOf } from './helpers'

const roots: Roots = new Map()

/** The days a rule anchored at `date` puts a series on, over `[from, to]`. */
function dates(date: string, repeat: Repeat, from: Date, to: Date): string[] {
  const series: StoreSeries = {
    date,
    time: null,
    repeat,
    entryKey: keyOf('note.md'),
    id: 'series-1',
    metadata: { participants: [] },
  }
  return expandRange([series], roots, from, to).map(o => o.date)
}

describe('yearly bymonth — the holiday shapes', () => {
  it('the fourth Thursday of November lands on Thanksgiving every year', () => {
    expect(dates(
      '2025-11-27',
      { type: 'schedule', freq: 'yearly', bymonth: [11], byweekday: ['th'], bysetpos: 4 },
      new Date(2025, 0, 1), new Date(2028, 11, 31),
    )).toEqual(['2025-11-27', '2026-11-26', '2027-11-25', '2028-11-23'])
  })

  it("the second Sunday of May lands on Mother's Day every year", () => {
    expect(dates(
      '2026-05-10',
      { type: 'schedule', freq: 'yearly', bymonth: [5], byweekday: ['su'], bysetpos: 2 },
      new Date(2026, 0, 1), new Date(2028, 11, 31),
    )).toEqual(['2026-05-10', '2027-05-09', '2028-05-14'])
  })

  it('a two-month bymonth yields both months every year, in calendar order', () => {
    expect(dates(
      '2026-03-10',
      { type: 'schedule', freq: 'yearly', bymonth: [3, 9] },
      new Date(2026, 0, 1), new Date(2027, 11, 31),
    )).toEqual(['2026-03-10', '2026-09-10', '2027-03-10', '2027-09-10'])
  })

  it('lists the months in calendar order however the rule spells them', () => {
    // `bymonth` is a set, not a sequence — a file listing September first must
    // still produce March first within each year.
    expect(dates(
      '2026-03-10',
      { type: 'schedule', freq: 'yearly', bymonth: [9, 3] },
      new Date(2026, 0, 1), new Date(2026, 11, 31),
    )).toEqual(['2026-03-10', '2026-09-10'])
  })

  it('applies bysetpos within each named month, not once across the year', () => {
    // The reading this branch commits to: "the first Monday of each quarter",
    // four dates a year — not the first Monday among all four months' Mondays
    // together, which would be January's alone.
    expect(dates(
      '2026-01-05',
      { type: 'schedule', freq: 'yearly', bymonth: [1, 4, 7, 10], byweekday: ['mo'], bysetpos: 1 },
      new Date(2026, 0, 1), new Date(2026, 11, 31),
    )).toEqual(['2026-01-05', '2026-04-06', '2026-07-06', '2026-10-05'])
  })
})

describe('yearly bymonth — months that cannot hold the day', () => {
  it('skips a February 29 in non-leap years instead of overflowing into March', () => {
    expect(dates(
      '2024-02-29',
      { type: 'schedule', freq: 'yearly', bymonth: [2], bymonthday: [29] },
      new Date(2025, 0, 1), new Date(2029, 11, 31),
    )).toEqual(['2028-02-29'])
  })

  it('drops only the months too short for the day, keeping the rest', () => {
    expect(dates(
      '2026-01-31',
      { type: 'schedule', freq: 'yearly', bymonth: [1, 2, 3], bymonthday: [31] },
      new Date(2026, 0, 1), new Date(2027, 11, 31),
    )).toEqual(['2026-01-31', '2026-03-31', '2027-01-31', '2027-03-31'])
  })

  it('resolves a negative bymonthday against each named month separately', () => {
    expect(dates(
      '2026-02-28',
      { type: 'schedule', freq: 'yearly', bymonth: [2, 6], bymonthday: [-1] },
      new Date(2026, 0, 1), new Date(2027, 11, 31),
    )).toEqual(['2026-02-28', '2026-06-30', '2027-02-28', '2027-06-30'])
  })

  it('matches nothing when every month it names is out of range', () => {
    // `repeat:` is read back from YAML with an unchecked cast, so a rule can
    // name month 13. It selects nothing rather than being clamped into some
    // other month — the same answer `bymonthday: [-32]` already gets.
    expect(dates(
      '2026-03-10',
      { type: 'schedule', freq: 'yearly', bymonth: [0, 13] },
      new Date(2026, 6, 1), new Date(2028, 11, 31),
    )).toEqual([])
  })
})

describe('yearly bymonth — what a rule written before bymonth existed still means', () => {
  it('naming no month repeats the anchor\'s own month and day', () => {
    expect(dates(
      '2025-08-20',
      { type: 'schedule', freq: 'yearly' },
      new Date(2025, 0, 1), new Date(2027, 11, 31),
    )).toEqual(['2025-08-20', '2026-08-20', '2027-08-20'])
  })

  it('honours interval, counting years from the anchor as it always has', () => {
    expect(dates(
      '2025-08-20',
      { type: 'schedule', freq: 'yearly', interval: 2, bymonth: [8, 11] },
      new Date(2025, 0, 1), new Date(2029, 11, 31),
    )).toEqual(['2025-08-20', '2025-11-20', '2027-08-20', '2027-11-20', '2029-08-20', '2029-11-20'])
  })

  it('tallies a count across every date the year produces, not one per year', () => {
    expect(dates(
      '2026-03-10',
      { type: 'schedule', freq: 'yearly', bymonth: [3, 9], end: { type: 'count', occurrences: 5 } },
      new Date(2026, 0, 1), new Date(2030, 11, 31),
    )).toEqual(['2026-03-10', '2026-09-10', '2027-03-10', '2027-09-10', '2028-03-10'])
  })
})

describe('yearly bymonth — the walk\'s own bounds', () => {
  // A yearly period used to be identified by a cursor sitting on the anchor's
  // month, which was indistinguishable from the calendar year while the only
  // date a yearly rule could produce sat in that same month. `bymonth` can
  // place a date in an *earlier* month than the anchor's, and then the two
  // come apart: the walk stops once the cursor passes the window, so with an
  // August cursor the March date of the last year in the window was never
  // generated. These pin both ends of the walk against that.

  it('generates a month before the anchor\'s in the final year of the window', () => {
    expect(dates(
      '2025-08-20',
      { type: 'schedule', freq: 'yearly', bymonth: [3], bymonthday: [15] },
      new Date(2025, 7, 1), new Date(2027, 5, 30),
    )).toEqual(['2025-08-20', '2026-03-15', '2027-03-15'])
  })

  it('generates it in a window that starts years after the anchor', () => {
    // The skip-ahead jumps the cursor straight to the period holding `from`,
    // which has to be the same period the walk would have reached one step at
    // a time.
    expect(dates(
      '2025-08-20',
      { type: 'schedule', freq: 'yearly', bymonth: [3], bymonthday: [15] },
      new Date(2029, 0, 1), new Date(2030, 11, 31),
    )).toEqual(['2029-03-15', '2030-03-15'])
  })

  it('skips ahead to the right period when interval is above 1', () => {
    expect(dates(
      '2025-08-20',
      { type: 'schedule', freq: 'yearly', interval: 3, bymonth: [3], bymonthday: [15] },
      new Date(2030, 0, 1), new Date(2035, 11, 31),
    )).toEqual(['2031-03-15', '2034-03-15'])
  })
})

describe('bymonth as a limit at the finer frequencies', () => {
  it('narrows a weekly rule to the months it names', () => {
    expect(dates(
      '2026-01-05',
      { type: 'schedule', freq: 'weekly', byweekday: ['mo'], bymonth: [1, 2] },
      new Date(2026, 0, 1), new Date(2027, 1, 28),
    )).toEqual([
      '2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26',
      '2026-02-02', '2026-02-09', '2026-02-16', '2026-02-23',
      '2027-01-04', '2027-01-11', '2027-01-18', '2027-01-25',
      '2027-02-01', '2027-02-08', '2027-02-15', '2027-02-22',
    ])
  })

  it('narrows a monthly rule to the months it names', () => {
    expect(dates(
      '2026-03-15',
      { type: 'schedule', freq: 'monthly', bymonthday: [15], bymonth: [3, 6, 9, 12] },
      new Date(2026, 0, 1), new Date(2026, 11, 31),
    )).toEqual(['2026-03-15', '2026-06-15', '2026-09-15', '2026-12-15'])
  })

  it('narrows a daily rule to the months it names', () => {
    expect(dates(
      '2026-02-26',
      { type: 'schedule', freq: 'daily', bymonth: [2] },
      new Date(2026, 1, 26), new Date(2026, 2, 5),
    )).toEqual(['2026-02-26', '2026-02-27', '2026-02-28'])
  })

  it('narrows an interval-bearing rule without shifting which days it picks', () => {
    // The limit runs after the period is chosen, so it removes dates the rule
    // would otherwise place — it never slides the fortnight onto another one.
    expect(dates(
      '2026-01-05',
      { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['mo'], bymonth: [1] },
      new Date(2026, 0, 1), new Date(2026, 4, 31),
    )).toEqual(['2026-01-05', '2026-01-19'])
  })
})
