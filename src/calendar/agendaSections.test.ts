import { describe, it, expect } from 'vitest'
import type { Occurrence, Priority } from '@/types'
import { computeAgendaSections, type Section, type FilterOccs } from './agendaSections'

const TODAY = new Date(2026, 5, 15)
const NOW = new Date(2026, 5, 15, 9, 0)

const noFilter: FilterOccs = occs => occs

interface OccOpts {
  time?: string | null
  done?: boolean
  priority?: Priority
  participants?: string[]
  duration?: string
  jsTime?: Date
}

/** A minimal expanded occurrence — computeAgendaSections only reads id/date/time/metadata. */
function occ(id: string, date: string, opts: OccOpts = {}): Occurrence {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = (opts.time ?? '00:00').split(':').map(Number)
  return {
    date,
    time: opts.time ?? null,
    source: 'explicit',
    fileSlug: 'note.md',
    id,
    metadata: {
      title: id,
      tags: [],
      items: [],
      participants: opts.participants ?? [],
      ...(opts.done !== undefined ? { done: opts.done } : null),
      ...(opts.priority !== undefined ? { priority: opts.priority } : null),
      ...(opts.duration !== undefined ? { duration: opts.duration } : null),
      jsTime: opts.jsTime ?? new Date(y, m - 1, d, hh, mm),
    },
  }
}

/** What the metadata overlay in computeExpansionCache does: a fresh array, new objects only where the metadata changed. */
function overlay(all: Occurrence[], id: string, patch: Record<string, unknown>): Occurrence[] {
  return all.map(o => (o.id === id ? { ...o, metadata: { ...o.metadata, ...patch } } : o))
}

const dayKeys = (sections: Section[]) => sections.map(s => (s.kind === 'overdue' ? '__overdue__' : s.dateKey))
const itemIds = (s: Section | undefined) => s?.items.map(o => o.id)
const findDay = (sections: Section[], key: string) => sections.find(s => s.kind === 'day' && s.dateKey === key)
const findOverdue = (sections: Section[]) => sections.find(s => s.kind === 'overdue')

// A past event (keeps the past day-section alive), an overdue task, two tasks
// today and one event today, and one future event.
function baseOccs(): Occurrence[] {
  return [
    occ('past-event', '2026-06-10', { time: '10:00' }),
    occ('overdue-task', '2026-06-10', { done: false }),
    occ('today-event', '2026-06-15', { time: '11:00' }),
    occ('today-task-a', '2026-06-15', { time: '08:00', done: false, priority: 'high' }),
    occ('today-task-b', '2026-06-15', { time: '08:00', done: false, priority: 'low' }),
    occ('future-event', '2026-06-20', { time: '09:00' }),
  ]
}

describe('computeAgendaSections', () => {
  it('lays out past days → overdue → current/future days', () => {
    const { sections, goToIndex } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)

    expect(dayKeys(sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-20'])
    expect(itemIds(findOverdue(sections))).toEqual(['overdue-task'])
    expect(itemIds(findDay(sections, '2026-06-10'))).toEqual(['past-event'])
    expect(sections[goToIndex]).toBe(findOverdue(sections))
  })

  it('seeds an empty today section so goToIndex always resolves', () => {
    const { sections, goToIndex } = computeAgendaSections(null, [], TODAY, NOW, noFilter)

    expect(dayKeys(sections)).toEqual(['2026-06-15'])
    expect(sections[goToIndex]).toBe(sections[0])
    expect(sections[0].items).toEqual([])
  })

  it('returns the identical cache when nothing changed', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, all, TODAY, NOW, noFilter)

    expect(second).toBe(first)
  })

  it('reuses every untouched section when one occurrence toggles done', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, overlay(all, 'today-task-a', { done: true }), TODAY, NOW, noFilter)

    expect(second).not.toBe(first)
    // Only today's section is rebuilt; the past day, the overdue pool and the
    // future day are handed back by reference (this is what stops DaySection
    // from re-rendering the rest of the vault).
    expect(findDay(second.sections, '2026-06-10')).toBe(findDay(first.sections, '2026-06-10'))
    expect(findDay(second.sections, '2026-06-20')).toBe(findDay(first.sections, '2026-06-20'))
    expect(findOverdue(second.sections)).toBe(findOverdue(first.sections))
    expect(findDay(second.sections, '2026-06-15')).not.toBe(findDay(first.sections, '2026-06-15'))
    // The grouping itself survived — no re-bucketing.
    expect(second.keyByIndex).toBe(first.keyByIndex)
    expect(second.sortedKeys).toBe(first.sortedKeys)
  })

  it('re-sorts the touched day so a completed task sinks below the open one', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    expect(itemIds(findDay(first.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-a', 'today-task-b'])

    const second = computeAgendaSections(first, overlay(all, 'today-task-a', { done: true }), TODAY, NOW, noFilter)
    expect(itemIds(findDay(second.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-b', 'today-task-a'])
    expect(findDay(second.sections, '2026-06-15')?.items[2].metadata.done).toBe(true)
  })

  it('moves a completed overdue task out of the overdue pool and into its own day', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const done = overlay(all, 'overdue-task', { done: true })
    const second = computeAgendaSections(first, done, TODAY, NOW, noFilter)

    expect(findOverdue(second.sections)).toBeUndefined()
    expect(itemIds(findDay(second.sections, '2026-06-10'))).toEqual(['past-event', 'overdue-task'])
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15', '2026-06-20'])

    // …and back again when it is un-completed.
    const third = computeAgendaSections(second, overlay(done, 'overdue-task', { done: false }), TODAY, NOW, noFilter)
    expect(itemIds(findOverdue(third.sections))).toEqual(['overdue-task'])
    expect(itemIds(findDay(third.sections, '2026-06-10'))).toEqual(['past-event'])
  })

  it('drops a past day-section that has nothing left but overdue tasks', () => {
    const all = [occ('lone-overdue', '2026-06-10', { done: false })]
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    expect(dayKeys(first.sections)).toEqual(['__overdue__', '2026-06-15'])

    // Completing it removes the overdue section and revives the day-section.
    const second = computeAgendaSections(first, overlay(all, 'lone-overdue', { done: true }), TODAY, NOW, noFilter)
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15'])
    expect(second.goToIndex).toBe(1)
  })

  it('keeps every covered day of a multiday event across a metadata change', () => {
    const trip = (day: number) =>
      occ('trip', `2026-06-${day}`, { duration: '3d', jsTime: new Date(2026, 5, day) })
    const all = [trip(16), trip(17), trip(18)]

    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    expect(dayKeys(first.sections)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'])

    // The overlay rewrites every occurrence sharing the id — all three days.
    const second = computeAgendaSections(first, overlay(all, 'trip', { priority: 'high' }), TODAY, NOW, noFilter)
    expect(dayKeys(second.sections)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'])
    for (const key of ['2026-06-16', '2026-06-17', '2026-06-18']) {
      expect(itemIds(findDay(second.sections, key))).toEqual(['trip'])
    }
  })

  it('re-groups from scratch when an occurrence moves to another day', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)

    // Same array length, but future-event jumped a day — the cached buckets
    // must not be reused.
    const moved = all.map(o =>
      o.id === 'future-event' ? occ('future-event', '2026-06-21', { time: '09:00' }) : o)
    const second = computeAgendaSections(first, moved, TODAY, NOW, noFilter)

    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-21'])
    expect(second.keyByIndex).not.toBe(first.keyByIndex)
  })

  it('re-groups from scratch when an occurrence is added or removed', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, all.filter(o => o.id !== 'future-event'), TODAY, NOW, noFilter)

    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15'])
  })

  it('rebuilds every section when the clock ticks, but reuses the grouping', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const later = computeAgendaSections(first, all, TODAY, new Date(2026, 5, 15, 12, 0), noFilter)

    expect(later.keyByIndex).toBe(first.keyByIndex)
    // today-event (11:00) is now in the past, so it sinks into the dimmed group.
    expect(itemIds(findDay(later.sections, '2026-06-15'))).toEqual(['today-task-a', 'today-task-b', 'today-event'])
  })

  it('applies the calendar filter per day and drops days it empties', () => {
    const all = [
      occ('mine', '2026-06-20', { time: '09:00', participants: ['alice'] }),
      occ('theirs', '2026-06-21', { time: '09:00', participants: ['bob'] }),
    ]
    const onlyAlice: FilterOccs = occs => occs.filter(o => o.metadata.participants.includes('alice'))
    const { sections } = computeAgendaSections(null, all, TODAY, NOW, onlyAlice)

    // 06-21 filters down to nothing and disappears; today is always kept.
    expect(dayKeys(sections)).toEqual(['2026-06-15', '2026-06-20'])
    expect(itemIds(findDay(sections, '2026-06-20'))).toEqual(['mine'])
  })

  it('rebuilds all sections when the filter changes', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const hideTasks: FilterOccs = occs => occs.filter(o => o.metadata.done === undefined)
    const second = computeAgendaSections(first, all, TODAY, NOW, hideTasks)

    expect(findOverdue(second.sections)).toBeUndefined()
    expect(itemIds(findDay(second.sections, '2026-06-15'))).toEqual(['today-event'])
    expect(second.keyByIndex).toBe(first.keyByIndex)
  })

  it('re-groups when today rolls over', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const tomorrow = new Date(2026, 5, 16)
    const second = computeAgendaSections(first, all, tomorrow, new Date(2026, 5, 16, 9, 0), noFilter)

    // Yesterday's tasks are overdue now, and 06-15's event section stays behind.
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15', '__overdue__', '2026-06-16', '2026-06-20'])
    // Pooled overdue is sorted by priority first, so the older task lands last.
    expect(itemIds(findOverdue(second.sections))).toEqual(['today-task-a', 'today-task-b', 'overdue-task'])
    expect(findDay(second.sections, '2026-06-16')?.items).toEqual([])
  })
})
