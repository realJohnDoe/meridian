import { describe, it, expect } from 'vitest'
import { dayRange } from '@/model/dateUtils'
import { expandRange } from '@/model/expansion'
import { keyOf } from './helpers'
import type { StoreOcc, Roots } from '@/types'

describe('dayRange', () => {
  it('spans start-of-day(firstDay) through end-of-day(lastDay)', () => {
    const { from, to } = dayRange(new Date(2026, 5, 1), new Date(2026, 5, 3))
    expect(from).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0))
    expect(to).toEqual(new Date(2026, 5, 3, 23, 59, 59, 999))
  })

  it('single-day range covers that whole day', () => {
    const { from, to } = dayRange(new Date(2026, 5, 1), new Date(2026, 5, 1))
    expect(from).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0))
    expect(to).toEqual(new Date(2026, 5, 1, 23, 59, 59, 999))
  })
})

function timedOcc(date: string, time: string): StoreOcc {
  return { date, time, source: 'explicit', entryKey: keyOf('note.md'), id: `occ-${date}-${time}`, metadata: { participants: [] } }
}

describe('dayRange as expandRange\'s window bound', () => {
  const roots: Roots = new Map()

  it('includes a 23:59 occurrence on the window\'s last day', () => {
    const { from, to } = dayRange(new Date(2026, 5, 1), new Date(2026, 5, 3))
    const occs = expandRange([timedOcc('2026-06-03', '23:59')], roots, from, to)
    expect(occs.map(o => o.date)).toContain('2026-06-03')
  })

  it('excludes a 00:00 occurrence the day after the window', () => {
    const { from, to } = dayRange(new Date(2026, 5, 1), new Date(2026, 5, 3))
    const occs = expandRange([timedOcc('2026-06-04', '00:00')], roots, from, to)
    expect(occs.map(o => o.date)).not.toContain('2026-06-04')
  })

  it('the bare-midnight bound this replaces would have dropped the same 23:59 occurrence', () => {
    // Pinning the bug dayRange exists to prevent: a naive end bound
    // (addDays, no end-of-day push) lands on midnight of the last day and
    // expandRange's inclusive-but-instant-sensitive filter then excludes any
    // timed occurrence on that day.
    const midnightTo = new Date(2026, 5, 3)
    const occs = expandRange([timedOcc('2026-06-03', '23:59')], roots, new Date(2026, 5, 1), midnightTo)
    expect(occs.map(o => o.date)).not.toContain('2026-06-03')
  })
})
