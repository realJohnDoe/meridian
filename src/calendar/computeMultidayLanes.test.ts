import { describe, it, expect } from 'vitest'
import { computeMultidayLanes } from './computeMultidayLanes'
import type { Occurrence } from '@/types'

function makeOcc(overrides: Partial<Occurrence> & { date: string; duration: string }): Occurrence {
  const { date, duration, ...rest } = overrides
  return {
    date,
    time: null,
    source: 'explicit',
    fileSlug: 'note.md',
    id: 'occ-1',
    metadata: { participants: [], title: '', tags: [], items: [], duration },
    ...rest,
  }
}

describe('computeMultidayLanes', () => {
  it('assigns non-overlapping events to the same lane', () => {
    const a = makeOcc({ id: 'a', date: '2026-06-01', duration: '3 days' })
    const b = makeOcc({ id: 'b', date: '2026-06-05', duration: '2 days' })

    const lanes = computeMultidayLanes([a, b])

    expect(lanes.find(l => l.occ.id === 'a')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'b')!.lane).toBe(0)
  })

  it('assigns overlapping events to distinct lanes', () => {
    const a = makeOcc({ id: 'a', date: '2026-06-01', duration: '5 days' })
    const b = makeOcc({ id: 'b', date: '2026-06-03', duration: '3 days' })

    const lanes = computeMultidayLanes([a, b])

    expect(lanes.find(l => l.occ.id === 'a')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'b')!.lane).toBe(1)
  })

  it('reuses a lane once its last event has ended', () => {
    const a = makeOcc({ id: 'a', date: '2026-06-01', duration: '2 days' })
    const b = makeOcc({ id: 'b', date: '2026-06-01', duration: '2 days' })
    const c = makeOcc({ id: 'c', date: '2026-06-03', duration: '2 days' })

    const lanes = computeMultidayLanes([a, b, c])

    expect(lanes.find(l => l.occ.id === 'a')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'b')!.lane).toBe(1)
    expect(lanes.find(l => l.occ.id === 'c')!.lane).toBe(0)
  })

  it('keeps the same lane for an event spanning multiple weeks', () => {
    const long = makeOcc({ id: 'long', date: '2026-06-01', duration: '21 days' })
    const short = makeOcc({ id: 'short', date: '2026-06-08', duration: '2 days' })

    const lanes = computeMultidayLanes([long, short])

    expect(lanes.find(l => l.occ.id === 'long')!.lane).toBe(0)
    expect(lanes.find(l => l.occ.id === 'short')!.lane).toBe(1)
  })

  it('returns an empty array for no events', () => {
    expect(computeMultidayLanes([])).toEqual([])
  })
})
