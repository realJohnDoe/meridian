import { describe, it, expect } from 'vitest'
import { addDays, startOfDay } from 'date-fns'
import { fmtISO, expandWithMultiday } from '@/model'
import type { Roots } from '@/types'
import { makeOcc, makeSeries, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { CHUNK_DAYS, chunkIndexFor, chunkRange, chunkIndicesFor } from './agendaChunks'
import { weekStartFor } from './weekRange'

const WS_VALUES = [0, 1, 6] as const

describe('chunkRange', () => {
  it.each(WS_VALUES)('aligns every chunk boundary to a week start (ws=%i)', (ws) => {
    for (let i = -3; i <= 3; i++) {
      const { from } = chunkRange(i, ws)
      expect(weekStartFor(from, ws).getTime()).toBe(from.getTime())
    }
  })

  it.each(WS_VALUES)('is adjacent — no gap, no overlap (ws=%i)', (ws) => {
    for (let i = -3; i <= 3; i++) {
      const a = chunkRange(i, ws)
      const b = chunkRange(i + 1, ws)
      // Chunk i's last day (end-of-day, per dayRange) is the day before chunk
      // i+1's first (start-of-day) — compare at day granularity.
      expect(startOfDay(addDays(a.to, 1)).getTime()).toBe(b.from.getTime())
      // Each chunk spans exactly CHUNK_DAYS calendar days.
      expect((b.from.getTime() - a.from.getTime()) / 86_400_000).toBe(CHUNK_DAYS)
    }
  })
})

describe('chunkIndexFor / chunkRange round-trip', () => {
  it.each(WS_VALUES)('the chunk containing a date always covers it (ws=%i)', (ws) => {
    const dates = [
      new Date(1970, 0, 1), new Date(1999, 11, 31), new Date(2020, 0, 1),
      new Date(2026, 5, 15), new Date(2026, 5, 15, 23, 59), new Date(2100, 0, 1),
    ]
    for (const d of dates) {
      const { from, to } = chunkRange(chunkIndexFor(d, ws), ws)
      expect(from.getTime()).toBeLessThanOrEqual(d.getTime())
      expect(to.getTime()).toBeGreaterThanOrEqual(d.getTime())
    }
  })

  it.each(WS_VALUES)('is stable across widely separated dates — the grid does not drift (ws=%i)', (ws) => {
    // Two chunks decades apart should still be exactly a whole number of
    // CHUNK_DAYS-sized steps apart — a floating/rounding drift in the epoch
    // math would show up as a fractional remainder here.
    const near = chunkIndexFor(new Date(1970, 1, 1), ws)
    const far = chunkIndexFor(new Date(2050, 1, 1), ws)
    const stepDays = (chunkRange(far, ws).from.getTime() - chunkRange(near, ws).from.getTime()) / 86_400_000
    expect(stepDays % CHUNK_DAYS).toBe(0)
  })
})

describe('chunkIndicesFor', () => {
  it.each(WS_VALUES)('returns a contiguous ascending run covering the whole span (ws=%i)', (ws) => {
    const from = new Date(2026, 0, 5)
    const to = new Date(2026, 5, 20)
    const indices = chunkIndicesFor(from, to, ws)

    expect(indices[0]).toBe(chunkIndexFor(from, ws))
    expect(indices.at(-1)).toBe(chunkIndexFor(to, ws))
    expect(indices).toEqual(Array.from({ length: indices.length }, (_, i) => indices[0]! + i))

    for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
      expect(indices).toContain(chunkIndexFor(d, ws))
    }
  })
})

describe('concatenated chunk expansion === single-window expansion', () => {
  const ws = 1

  it('agrees for a timed occ exactly on a chunk boundary, a multiday item spanning one, and a series crossing several', () => {
    // Six chunks (168 days), anchored to the grid so the single-window pass
    // and the chunked passes cover exactly the same span.
    const startIdx = chunkIndexFor(new Date(2026, 0, 1), ws)
    const endIdx = startIdx + 5
    const { from: winFrom } = chunkRange(startIdx, ws)
    const { to: winTo } = chunkRange(endIdx, ws)

    // The first day of the chunk after startIdx — an exact chunk boundary.
    const boundaryDay = chunkRange(startIdx + 1, ws).from
    // The last day of chunk startIdx+2, so a 4-day item starting the day
    // before it spans straight across that chunk's own boundary.
    const multidayStart = addDays(chunkRange(startIdx + 2, ws).to, -1)

    const roots: Roots = new Map([
      ...makeRoots('boundary.md'),
      ...makeRoots('multiday.md'),
      ...makeRoots('series.md'),
    ])

    const boundaryOcc = makeOcc({
      id: 'boundary-occ', date: fmtISO(boundaryDay), time: '09:00', entryKey: testKey('boundary.md'),
      metadata: { vaultId: TEST_VAULT, fileSlug: 'boundary.md', title: 'On the line', tags: [], items: [], participants: [] },
    })
    const multidayOcc = makeOcc({
      id: 'multiday-occ', date: fmtISO(multidayStart), time: null, entryKey: testKey('multiday.md'),
      metadata: { vaultId: TEST_VAULT, fileSlug: 'multiday.md', title: 'Spans the line', tags: [], items: [], participants: [], duration: '4 days' },
    })
    const series = makeSeries({
      id: 'series-1', date: fmtISO(winFrom), time: '08:00', entryKey: testKey('series.md'),
      repeat: { type: 'schedule', freq: 'weekly' },
    })

    const items = [boundaryOcc, multidayOcc, series]

    const single = expandWithMultiday(items, roots, winFrom, winTo)
    const chunked = chunkIndicesFor(winFrom, winTo, ws).flatMap(i => {
      const { from, to } = chunkRange(i, ws)
      return expandWithMultiday(items, roots, from, to)
    })

    const shape = (occs: typeof single) => occs.map(o => `${o.id}@${o.metadata.jsTime?.toISOString() ?? ''}`)
    expect(shape(chunked)).toEqual(shape(single))
    expect(single.length).toBeGreaterThan(10) // the weekly series alone generates one occurrence per chunk
  })
})
