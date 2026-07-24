import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { occState, occKind, occIsRecur } from '@/occView'
import type { Occurrence } from '@/types'

// Fixed "now": 2026-06-15 12:00 local time.
const NOW = new Date(2026, 5, 15, 12, 0, 0)

function makeOcc(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    date: '2026-06-15',
    time: null,
    source: 'explicit',
    fileSlug: 'note.md',
    id: 'occ-1',
    metadata: { participants: [], title: '', tags: [], items: [] },
    ...overrides,
  }
}

describe('occKind', () => {
  it('is task when done is defined', () => {
    expect(occKind(makeOcc({ metadata: { participants: [], title: '', tags: [], items: [], done: false } }))).toBe('task')
  })
  it('is event when date is set and done is undefined', () => {
    expect(occKind(makeOcc({ date: '2026-06-15' }))).toBe('event')
  })
  it('is note when date is empty and done is undefined', () => {
    expect(occKind(makeOcc({ date: '' }))).toBe('note')
  })
})

describe('occIsRecur', () => {
  it('is true when ownerId is set', () => {
    expect(occIsRecur(makeOcc({ ownerId: 'series-1' }))).toBe(true)
  })
  it('is false when ownerId is absent', () => {
    expect(occIsRecur(makeOcc())).toBe(false)
  })
})

describe('occState', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns done when metadata.done is true, regardless of other fields', () => {
    const o = makeOcc({ metadata: { participants: [], title: '', tags: [], items: [], done: true, priority: 'high' } })
    expect(occState(o)).toBe('done')
  })

  it('returns note for a note occurrence', () => {
    const o = makeOcc({ date: '' })
    expect(occState(o)).toBe('note')
  })

  it('returns task-p1/p2/p3 for high/medium/low priority tasks', () => {
    const base = { participants: [], title: '', tags: [], items: [], done: false }
    expect(occState(makeOcc({ metadata: { ...base, priority: 'high' } }))).toBe('task-p1')
    expect(occState(makeOcc({ metadata: { ...base, priority: 'medium' } }))).toBe('task-p2')
    expect(occState(makeOcc({ metadata: { ...base, priority: 'low' } }))).toBe('task-p3')
  })

  it('returns task-open for a task with no priority', () => {
    const o = makeOcc({ metadata: { participants: [], title: '', tags: [], items: [], done: false } })
    expect(occState(o)).toBe('task-open')
  })

  it('returns event-future for a multiday event whose day has not passed yet', () => {
    const o = makeOcc({
      date: '2026-06-15',
      metadata: { participants: [], title: '', tags: [], items: [], duration: '3 days', jsTime: new Date(2026, 5, 15) },
    })
    expect(occState(o)).toBe('event-future')
  })

  it('returns event-past for a multiday event whose day is before today', () => {
    const o = makeOcc({
      date: '2026-06-10',
      metadata: { participants: [], title: '', tags: [], items: [], duration: '3 days', jsTime: new Date(2026, 5, 10) },
    })
    expect(occState(o)).toBe('event-past')
  })

  it('returns event-future for a multiday event with no jsTime', () => {
    const o = makeOcc({
      metadata: { participants: [], title: '', tags: [], items: [], duration: '3 days' },
    })
    expect(occState(o)).toBe('event-future')
  })

  it('keeps a whole-day event (no time) colored until midnight, not 00:01', () => {
    const o = makeOcc({
      time: null,
      metadata: { participants: [], title: '', tags: [], items: [], jsTime: new Date(2026, 5, 15) },
    })
    expect(occState(o)).toBe('event-future')
  })

  it('marks a whole-day event from a past day as event-past', () => {
    const o = makeOcc({
      time: null,
      metadata: { participants: [], title: '', tags: [], items: [], jsTime: new Date(2026, 5, 14) },
    })
    expect(occState(o)).toBe('event-past')
  })

  it('keeps a timed event with explicit duration future while still ongoing', () => {
    const o = makeOcc({
      time: '11:30',
      metadata: { participants: [], title: '', tags: [], items: [], duration: '2 hours', jsTime: new Date(2026, 5, 15, 11, 30) },
    })
    // 11:30 + 2h = 13:30, which is after NOW (12:00) -> still future
    expect(occState(o)).toBe('event-future')
  })

  it('marks a timed event with explicit duration as past once it has ended', () => {
    const o = makeOcc({
      time: '09:00',
      metadata: { participants: [], title: '', tags: [], items: [], duration: '1 hour', jsTime: new Date(2026, 5, 15, 9, 0) },
    })
    // 09:00 + 1h = 10:00, which is before NOW (12:00) -> past
    expect(occState(o)).toBe('event-past')
  })

  it('marks a timed event with no duration as past once its start time has passed', () => {
    const o = makeOcc({
      time: '09:00',
      metadata: { participants: [], title: '', tags: [], items: [], jsTime: new Date(2026, 5, 15, 9, 0) },
    })
    expect(occState(o)).toBe('event-past')
  })

  it('returns event-future for a timed event still ahead of now', () => {
    const o = makeOcc({
      time: '18:00',
      metadata: { participants: [], title: '', tags: [], items: [], jsTime: new Date(2026, 5, 15, 18, 0) },
    })
    expect(occState(o)).toBe('event-future')
  })

  // Cross-midnight timed duration: started the previous day, ends today. This
  // is the one case where truncating `now` to day granularity (as e.g. a
  // sort's stable "today" placeholder would) disagrees with the true instant
  // — see the AgendaView/DayPane/MonthGrid callers of sortOccs, none of which
  // may take that shortcut for this reason.
  it('keeps a cross-midnight timed duration future while still ongoing after midnight', () => {
    vi.setSystemTime(new Date(2026, 5, 15, 1, 0)) // 1:00 AM, still within the window below
    const o = makeOcc({
      date: '2026-06-14',
      time: '22:00',
      metadata: { participants: [], title: '', tags: [], items: [], duration: '4 hours', jsTime: new Date(2026, 5, 14, 22, 0) },
    })
    // 22:00 (previous day) + 4h = 02:00 today, which is after 01:00 -> still future
    expect(occState(o)).toBe('event-future')
  })

  it('marks a cross-midnight timed duration as past once it has truly ended, using the day it started rather than the day it ends', () => {
    const o = makeOcc({
      date: '2026-06-14',
      time: '22:00',
      metadata: { participants: [], title: '', tags: [], items: [], duration: '4 hours', jsTime: new Date(2026, 5, 14, 22, 0) },
    })
    // 22:00 (previous day) + 4h = 02:00 today, which is before NOW (12:00) -> past.
    // A day-truncated `now` (midnight today) would wrongly read this as future.
    expect(occState(o)).toBe('event-past')
  })
})
