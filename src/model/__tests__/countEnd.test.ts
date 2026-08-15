import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import { parseToStoreItems } from '@/model/storeItems'
import type { Roots } from '@/types'
import { rootsOf, TEST_VAULT } from './helpers'

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
