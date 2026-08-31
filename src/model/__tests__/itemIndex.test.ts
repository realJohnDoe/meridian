import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import { buildItemIndex } from '@/model/itemIndex'
import { isSeries } from '@/types'
import { parseFixture, rootsOf } from './helpers'

// mixed-series-standalones carries exactly what this file's cases need: two
// series in one entry, one of them with two override children (one of which
// is `excluded: true`), plus a standalone multiday item — see the fixture.
const FIXTURE = 'mixed-series-standalones'

describe('buildItemIndex', () => {
  it('partitions series, standalones, and override children by ownerId', () => {
    const { items } = parseFixture(FIXTURE)
    const index = buildItemIndex(items)

    // Every series in `items` lands in `index.series`, nowhere else.
    expect(index.series.map(s => s.id).sort()).toEqual(
      items.filter(isSeries).map(s => s.id).sort(),
    )

    // Every non-series item lands in exactly one of standalones/children —
    // partitioned on the same `!!ownerId` test `isStandaloneOcc` uses.
    const nonSeries = items.filter(i => !isSeries(i))
    const allChildren = [...index.childrenByOwnerId.values()].flat()
    expect(index.standalones.length + allChildren.length).toBe(nonSeries.length)
    for (const s of index.standalones) expect(s.ownerId).toBeUndefined()
    for (const c of allChildren) expect(c.ownerId).toBeTruthy()

    // Each child is filed under its own ownerId, not some other series'.
    for (const [ownerId, children] of index.childrenByOwnerId) {
      expect(children.every(c => c.ownerId === ownerId)).toBe(true)
    }

    // This fixture specifically: two series, each with at least one override,
    // one standalone (the 2026-07-01 multiday item).
    expect(index.series).toHaveLength(2)
    expect(index.standalones).toHaveLength(1)
    expect(index.standalones[0]?.date).toBe('2026-07-01')
    expect(allChildren.length).toBeGreaterThan(0)
  })
})

describe('expandRange with a pre-built ItemIndex', () => {
  it('returns identical results with and without a supplied index', () => {
    const { items, root } = parseFixture(FIXTURE)
    const roots = rootsOf(root)
    const from = new Date('2026-01-01')
    const to = new Date('2026-12-31')

    const withoutIndex = expandRange(items, roots, from, to)
    const withIndex = expandRange(items, roots, from, to, buildItemIndex(items))

    expect(withIndex).toEqual(withoutIndex)

    // Guard against a vacuous pass (both sides empty): the fixture's
    // excluded override must have actually suppressed an occurrence, and its
    // reschedule override and standalone must both still be present.
    expect(withoutIndex.length).toBeGreaterThan(0)
    expect(withoutIndex.some(o => o.date === '2026-04-08' && o.time === '09:00')).toBe(false)
    expect(withoutIndex.some(o => o.date === '2026-04-08' && o.time === '10:00')).toBe(true)
    expect(withoutIndex.some(o => o.date === '2026-07-01')).toBe(true)
  })
})
