import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { serializeEntry } from '@/model/collapse'
import { expandRange } from '@/model/expansion'
import { toggleDone } from '@/model/storeOps'
import type { Entries } from '@/types'

function expand(content: string) {
  const p = parseToStoreItems('a.md', content, 'v')
  return expandRange(p.items, new Map([[p.key, p.root]]),
    new Date(2024, 0, 1), new Date(2024, 11, 31, 23, 59, 59))
}

// Data-integrity survey, finding #3: a series whose clock time falls inside
// its viewer's spring-forward gap silently loses its final occurrence (bound
// walks) or has its clock time rewritten (after_completion). Pinned to zones
// with a gap rather than depending on the runner's own TZ.
describe.each([
  ['America/New_York', 1],
  ['Antarctica/Troll', 2],
])('DST spring-forward (%s)', (tz) => {
  let originalTz: string | undefined

  beforeAll(() => {
    originalTz = process.env.TZ
    process.env.TZ = tz
  })

  afterAll(() => {
    process.env.TZ = originalTz
  })

  it('a daily count:10 series yields 10 occurrences', () => {
    expect(expand(`---\ntitle: S\ndate: 2024-03-08\ntime: "02:30"\nrepeat:\n  type: schedule\n  freq: daily\n  end:\n    type: count\n    occurrences: 10\n---\n`)).toHaveLength(10)
  })

  it('a weekly count:5 series anchored on the transition weekday yields all 5', () => {
    expect(expand(`---\ntitle: W\ndate: 2024-02-25\ntime: "02:30"\nrepeat:\n  type: schedule\n  freq: weekly\n  end:\n    type: count\n    occurrences: 5\n---\n`).map(o => o.date))
      .toEqual(['2024-02-25', '2024-03-03', '2024-03-10', '2024-03-17', '2024-03-24'])
  })

  it('an until bound carrying a time still admits its last day', () => {
    expect(expand(`---\ntitle: U\ndate: 2024-03-08\ntime: "02:30"\nrepeat:\n  type: schedule\n  freq: daily\n  end:\n    type: until\n    date: 2024-03-15\n    time: "02:30"\n---\n`).map(o => o.date))
      .toContain('2024-03-15')
  })

  it('completing an after_completion occurrence keeps its authored clock time', () => {
    const CONTENT = `---\ntitle: A\ndate: 2024-03-10\ntime: "02:30"\nrepeat:\n  type: after_completion\n  interval: 3 days\n---\n`
    const p = parseToStoreItems('n.md', CONTENT, 'v')
    const entries: Entries = new Map([[p.key, p]])
    const [occ] = expand(CONTENT)
    const e = toggleDone({ entries }, occ!).entries.get(p.key)!
    expect(serializeEntry(e.items, e.root)).not.toContain('03:30')
  })
})
