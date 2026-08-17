import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import { parseToStoreItems } from '@/model/storeItems'
import type { Repeat, Roots, StoreSeries } from '@/types'
import { keyOf, rootsOf, TEST_VAULT } from './helpers'

const noRoots: Roots = new Map()

/** A single count-bounded series anchored at 2026-01-01 unless overridden. */
function counted(repeat: Repeat, date = '2026-01-01'): StoreSeries[] {
  return [{
    date,
    time: '08:00',
    repeat,
    entryKey: keyOf('counted.md'),
    id: 'counted-1',
    metadata: { participants: [] },
  }]
}

describe('expandRange "count" end', () => {
  it('a count-bounded series yields the same occurrences regardless of the query window', () => {
    const p = parseToStoreItems(
      's.md',
      [
        '---',
        'title: Physio',
        'date: "2026-01-05"',
        'time: "09:00"',
        'repeat:',
        '  type: schedule',
        '  freq: weekly',
        '  byweekday: [mo]',
        '  end:',
        '    type: count',
        '    occurrences: 3',
        '---',
      ].join('\n'),
      TEST_VAULT,
    )
    const roots: Roots = rootsOf(p.root)
    const all = expandRange(
      p.items,
      roots,
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    )

    expect(all.map((o) => o.date)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
    ])
    expect(
      expandRange(p.items, roots, new Date(2026, 2, 1), new Date(2026, 2, 31)),
    ).toEqual([])
    expect(
      expandRange(p.items, roots, new Date(2030, 0, 1), new Date(2030, 0, 31)),
    ).toEqual([])
  })
})

describe('expandRange "count" end beyond the period cap', () => {
  // Gap K: `count` used to be enumerated with no date bound at all, so the
  // 500-iteration runaway guard — which counts *periods* — silently truncated
  // any series yielding roughly one occurrence per period.
  it('a daily series with count: 1000 yields all 1000 occurrences', () => {
    const items = counted({ type: 'schedule', freq: 'daily', end: { type: 'count', occurrences: 1000 } })
    const dates = expandRange(items, noRoots, new Date(2026, 0, 1), new Date(2029, 0, 1)).map(o => o.date)

    expect(dates).toHaveLength(1000)
    expect(dates[0]).toBe('2026-01-01')
    expect(dates[999]).toBe('2028-09-26')
  })

  it('still truncates nothing when the window covers only the series tail', () => {
    const items = counted({ type: 'schedule', freq: 'daily', end: { type: 'count', occurrences: 1000 } })
    const dates = expandRange(items, noRoots, new Date(2028, 8, 20), new Date(2028, 9, 10)).map(o => o.date)

    // The last seven occurrences and nothing past 2028-09-26.
    expect(dates).toEqual([
      '2028-09-20', '2028-09-21', '2028-09-22', '2028-09-23',
      '2028-09-24', '2028-09-25', '2028-09-26',
    ])
  })

  it('counts occurrences, not periods, for a sparse rule that skips months', () => {
    // Only seven months in twelve have a 31st, so five occurrences span eight
    // periods — the count has to be tallied off the dates, not the cursor.
    const items = counted(
      { type: 'schedule', freq: 'monthly', bymonthday: [31], end: { type: 'count', occurrences: 5 } },
      '2026-01-31',
    )
    const dates = expandRange(items, noRoots, new Date(2026, 0, 1), new Date(2027, 0, 1)).map(o => o.date)

    expect(dates).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31', '2026-08-31'])
  })

  it('terminates on a rule that can never match', () => {
    // -32 resolves below day 1 in every month, so no period ever yields a date.
    const items = counted(
      { type: 'schedule', freq: 'monthly', bymonthday: [-32], end: { type: 'count', occurrences: 100 } },
    )
    const dates = expandRange(items, noRoots, new Date(2026, 0, 1), new Date(2030, 0, 1)).map(o => o.date)

    expect(dates).toEqual(['2026-01-01'])  // the anchor, and nothing generated
  })

  it('treats a repeated BYxxx value as one occurrence, not two', () => {
    const items = counted(
      { type: 'schedule', freq: 'monthly', bymonthday: [15, 15], end: { type: 'count', occurrences: 3 } },
      '2026-01-15',
    )
    const dates = expandRange(items, noRoots, new Date(2026, 0, 1), new Date(2027, 0, 1)).map(o => o.date)

    expect(dates).toEqual(['2026-01-15', '2026-02-15', '2026-03-15'])
  })

  it('does not re-walk the series on every expansion', () => {
    const items = counted({ type: 'schedule', freq: 'daily', end: { type: 'count', occurrences: 5000 } })
    // One narrow window far from the anchor, expanded repeatedly. Resolving the
    // count bound walks 5000 periods once; after that each expansion skips
    // analytically to the window, so 200 of them must not cost 200 walks.
    const from = new Date(2032, 0, 1), to = new Date(2032, 0, 31)
    expandRange(items, noRoots, from, to)  // warm the resolved bound

    const started = performance.now()
    for (let i = 0; i < 200; i++) expandRange(items, noRoots, from, to)
    const perExpansion = (performance.now() - started) / 200

    expect(perExpansion).toBeLessThan(1)
  })
})
