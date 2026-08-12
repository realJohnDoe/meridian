import { describe, it, expect } from 'vitest'
import type { Occurrence, Priority } from '@/types'
import { computeAgendaSections, estimateRow, type Section, type FilterOccs, type AgendaRow } from './agendaSections'

const TODAY = new Date(2026, 5, 15) // a Monday
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
  const [y = NaN, m = NaN, d = NaN] = date.split('-').map(Number)
  const [hh = NaN, mm = NaN] = (opts.time ?? '00:00').split(':').map(Number)
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

  it('collapses the overdue section to just its header row when overdueCollapsed is true', () => {
    const { sections, goToIndex } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter, TODAY, true)

    const overdue = findOverdue(sections)
    // `items` still carries the full pool — only what's rendered shrinks.
    expect(itemIds(overdue)).toEqual(['overdue-task'])
    expect(overdue?.rows).toHaveLength(1)
    expect(overdue?.rows[0]).toMatchObject({ kind: 'header', label: 'Overdue', collapsed: true, count: 1 })
    // The scroll target is still the overdue section — collapsed, it's just one row.
    expect(sections[goToIndex]).toBe(overdue)
  })

  it('rebuilds the overdue section when overdueCollapsed flips, even with no occurrence change', () => {
    const all = baseOccs()
    const collapsed = computeAgendaSections(null, all, TODAY, NOW, noFilter, TODAY, true)
    const expanded = computeAgendaSections(collapsed, all, TODAY, NOW, noFilter, TODAY, false)

    expect(expanded).not.toBe(collapsed)
    expect(findOverdue(expanded.sections)?.rows).toHaveLength(2) // header + the one overdue task
    expect(findOverdue(expanded.sections)?.rows[0]).toMatchObject({ collapsed: false, count: 1 })
  })

  it('seeds an empty today section so goToIndex always resolves', () => {
    const { sections, goToIndex } = computeAgendaSections(null, [], TODAY, NOW, noFilter)

    expect(dayKeys(sections)).toEqual(['2026-06-15'])
    expect(sections[goToIndex]).toBe(sections[0])
    expect(sections[0]!.items).toEqual([])
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
    // future day are handed back by reference (this is what stops AgendaRow
    // from re-rendering the rest of the vault).
    expect(findDay(second.sections, '2026-06-10')).toBe(findDay(first.sections, '2026-06-10'))
    expect(findDay(second.sections, '2026-06-20')).toBe(findDay(first.sections, '2026-06-20'))
    expect(findOverdue(second.sections)).toBe(findOverdue(first.sections))
    expect(findDay(second.sections, '2026-06-15')).not.toBe(findDay(first.sections, '2026-06-15'))
    // The grouping itself survived — no re-bucketing.
    expect(second.keyByIndex).toBe(first.keyByIndex)
    expect(second.sortedKeys).toBe(first.sortedKeys)
    // Untouched sections' `rows` arrays are reference-stable too — this is
    // what lets a flat-list virtualizer skip remeasuring rows the toggle
    // didn't touch (see the AgendaRow doc comment in agendaSections.ts).
    expect(findDay(second.sections, '2026-06-10')?.rows).toBe(findDay(first.sections, '2026-06-10')?.rows)
    expect(findDay(second.sections, '2026-06-20')?.rows).toBe(findDay(first.sections, '2026-06-20')?.rows)
    expect(findOverdue(second.sections)?.rows).toBe(findOverdue(first.sections)?.rows)
  })

  it('re-sorts the touched day so a completed task sinks below the open one', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    expect(itemIds(findDay(first.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-a', 'today-task-b'])

    const second = computeAgendaSections(first, overlay(all, 'today-task-a', { done: true }), TODAY, NOW, noFilter)
    expect(itemIds(findDay(second.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-b', 'today-task-a'])
    expect(findDay(second.sections, '2026-06-15')?.items[2]!.metadata.done).toBe(true)
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

  it('rebuilds when the locale week-start changes, even with no occurrence change', () => {
    const all = baseOccs()
    const mondayStart = computeAgendaSections(null, all, TODAY, NOW, noFilter, TODAY, false, 1)
    const sundayStart = computeAgendaSections(mondayStart, all, TODAY, NOW, noFilter, TODAY, false, 0)

    expect(sundayStart).not.toBe(mondayStart)
  })
})

describe('computeAgendaSections — flat rows', () => {
  it('badges only a day\'s first occurrence row; later rows on the same day carry no badge', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)
    // isToday (not just dateKey) excludes the overdue-task row, which also
    // carries dateKey '2026-06-15' (see the todayKey comment on overdueRows)
    // but belongs to a different day's own content.
    const todayRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'occ' }> => r.kind === 'occ' && r.dateKey === '2026-06-15' && r.isToday)

    expect(todayRows).toHaveLength(3)
    expect(todayRows.map(r => !!r.badge)).toEqual([true, false, false])
    expect(todayRows[0]!.badge).toEqual({ date: new Date(2026, 5, 15), isToday: true })
  })

  it('never badges overdue rows — they carry a date chip on the card instead (showDate)', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)
    const overdueRow = rows.find(r => r.kind === 'occ' && r.occ.id === 'overdue-task')

    expect(overdueRow?.kind === 'occ' && overdueRow.badge).toBeNull()
    expect(overdueRow?.kind === 'occ' && overdueRow.showDate).toBe(true)
  })

  it('preserves the past → overdue → current/future order of content rows around the week/month dividers', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)
    const content = rows.filter(r => r.kind !== 'month' && r.kind !== 'week')

    expect(content.map(r => r.kind)).toEqual([
      'occ',                // 2026-06-10 (past-event) — badged, no header row anymore
      'header', 'occ',       // __overdue__ (overdue-task)
      'occ', 'occ', 'occ',   // 2026-06-15 (today-event, today-task-a, today-task-b)
      'occ',                 // 2026-06-20 (future-event)
    ])
  })

  it("carries todayKey on overdue rows, not each occurrence's own past day", () => {
    const { rows } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)

    const overdueHeader = rows.find(r => r.kind === 'header')
    const overdueOccRow = rows.find(r => r.kind === 'occ' && r.occ.id === 'overdue-task')
    expect(overdueHeader?.dateKey).toBe('2026-06-15')
    expect(overdueOccRow?.dateKey).toBe('2026-06-15')
  })

  it('gives every row a globally-unique key, including a multiday task pooled into overdue from two past days', () => {
    // A multiday task's occurrences share one id across every day it spans —
    // the two below are what an undone multiday task pooled into overdue
    // from two separate past days looks like.
    const day1 = occ('multi-task', '2026-06-10', { done: false })
    const day2 = occ('multi-task', '2026-06-11', { done: false })
    const { rows } = computeAgendaSections(null, [day1, day2, ...baseOccs()], TODAY, NOW, noFilter)

    const keys = rows.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)

    const multidayRows = rows.filter(r => r.kind === 'occ' && r.occ.id === 'multi-task')
    expect(multidayRows).toHaveLength(2)
    expect(multidayRows[0]!.key).not.toBe(multidayRows[1]!.key)
  })

  it("points goToRowIndex at the overdue header when present, else at today's own badged row", () => {
    const withOverdue = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)
    const overdueTarget = withOverdue.rows[withOverdue.goToRowIndex]
    expect(overdueTarget?.kind).toBe('header')

    const onlyToday = [occ('today-event', '2026-06-15', { time: '11:00' })]
    const noOverdue = computeAgendaSections(null, onlyToday, TODAY, NOW, noFilter)
    const todayTarget = noOverdue.rows[noOverdue.goToRowIndex]
    expect(todayTarget?.kind).toBe('occ')
    expect(todayTarget?.kind === 'occ' && todayTarget.badge?.isToday).toBe(true)
  })

  it('emits a badged day-empty row (not a header) for a forced, contentless anchor day', () => {
    const { rows } = computeAgendaSections(null, [], TODAY, NOW, noFilter)
    const todayRow = rows.find(r => r.kind === 'day-empty')

    expect(todayRow?.kind === 'day-empty' && todayRow.isToday).toBe(true)
    expect(todayRow?.kind === 'day-empty' && todayRow.date).toEqual(new Date(2026, 5, 15))
  })
})

describe('computeAgendaSections — month/week dividers', () => {
  it('gives every week in the window a divider row, even ones with nothing scheduled', () => {
    const { rows } = computeAgendaSections(null, [], TODAY, NOW, noFilter)
    // [anchor-365, anchor+90] spans a little over 65 weeks.
    expect(rows.filter(r => r.kind === 'week').length).toBeGreaterThan(60)
  })

  it('gives every month in the window a divider row', () => {
    const { rows } = computeAgendaSections(null, [], TODAY, NOW, noFilter)
    // ~15-16 calendar months across a 455-day window.
    expect(rows.filter(r => r.kind === 'month').length).toBeGreaterThan(13)
  })

  it('omits the year from a month divider in the current year, includes it for others', () => {
    const { rows } = computeAgendaSections(null, [], TODAY, NOW, noFilter)
    const monthRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'month' }> => r.kind === 'month')

    expect(monthRows.find(r => r.label === 'June')).toBeDefined()
    expect(monthRows.find(r => r.label === 'December 2025')).toBeDefined()
  })

  it('labels a week with its ISO week number and date range', () => {
    const { rows } = computeAgendaSections(null, [], TODAY, NOW, noFilter)
    const weekRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'week' }> => r.kind === 'week')

    // TODAY (2026-06-15) is a Monday, so its own week starts on it.
    const todaysWeek = weekRows.find(r => r.dateKey === '2026-06-15')
    expect(todaysWeek?.label).toMatch(/^Week \d+, Jun 15 – 21$/)
  })

  it('places the month/week dividers before the day content that falls inside them', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)
    const todayOccIndex = rows.findIndex(r => r.kind === 'occ' && r.dateKey === '2026-06-15')
    const precedingWeek = [...rows.slice(0, todayOccIndex)].reverse().find(r => r.kind === 'week')
    expect(precedingWeek?.dateKey).toBe('2026-06-15')
  })
})

describe('computeAgendaSections — anchor', () => {
  it('defaults to today, preserving the overdue-preferring scroll target', () => {
    const { goToRowIndex, rows } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('header')
  })

  it('targets a day with content directly when anchored there, ignoring overdue', () => {
    const anchor = new Date(2026, 5, 20) // future-event's own day
    const { sections, rows, goToRowIndex } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter, anchor)

    expect(dayKeys(sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-20'])
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('occ')
    expect(target?.dateKey).toBe('2026-06-20')
  })

  it('force-renders an empty section at the anchor — future or past — purely as a scroll target', () => {
    const futureAnchor = new Date(2026, 5, 25) // no occurrences on this day
    const future = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter, futureAnchor)
    expect(dayKeys(future.sections)).toContain('2026-06-25')
    const futureTarget = future.sections[future.goToIndex]
    expect(futureTarget?.kind === 'day' && futureTarget.items).toEqual([])

    const pastAnchor = new Date(2026, 5, 5) // before any occurrence, and before today
    const past = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter, pastAnchor)
    expect(dayKeys(past.sections)).toContain('2026-06-05')
    const pastTarget = past.sections[past.goToIndex]
    expect(pastTarget?.kind === 'day' && pastTarget.items).toEqual([])
  })

  it('does not force-render an empty today section when anchored elsewhere', () => {
    const anchor = new Date(2026, 5, 20)
    const onlyFuture = [occ('future-event', '2026-06-20', { time: '09:00' })]
    const { sections } = computeAgendaSections(null, onlyFuture, TODAY, NOW, noFilter, anchor)

    expect(dayKeys(sections)).toEqual(['2026-06-20'])
  })

  it('re-groups from scratch when only the anchor changes', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, all, TODAY, NOW, noFilter, new Date(2026, 5, 20))

    expect(second).not.toBe(first)
    expect(second.rows[second.goToRowIndex]?.dateKey).toBe('2026-06-20')
  })

  it('still splices in the overdue rows when the anchor is far enough away that today falls outside the window', () => {
    const all = baseOccs()
    const farAnchor = new Date(2027, 5, 15) // 365 days ahead of TODAY — well outside [anchor-365, anchor+90]
    const { rows } = computeAgendaSections(null, all, TODAY, NOW, noFilter, farAnchor)

    expect(rows.some(r => r.kind === 'header')).toBe(true)
  })
})

describe('estimateRow', () => {
  const rowFor = (rows: AgendaRow[], id: string) =>
    rows.find(r => r.kind === 'occ' && r.occ.id === id)!

  it('estimates a plain day row shorter than one carrying a meta row', () => {
    const { rows } = computeAgendaSections(
      null,
      [
        occ('untimed', '2026-06-16'),
        occ('timed', '2026-06-16', { time: '11:00' }),
        occ('with-duration', '2026-06-16', { duration: '30m' }),
      ],
      TODAY, NOW, noFilter,
    )

    // No badge at all — the card sits on its min-h-11 floor.
    expect(estimateRow(rowFor(rows, 'untimed'))).toBe(50)
    // A time badge or a duration chip each force the meta row.
    expect(estimateRow(rowFor(rows, 'timed'))).toBe(68)
    expect(estimateRow(rowFor(rows, 'with-duration'))).toBe(68)
  })

  it('estimates overdue rows at the meta height — they always show a date badge', () => {
    const { rows } = computeAgendaSections(
      null,
      [occ('overdue-untimed', '2026-06-10', { done: false })],
      TODAY, NOW, noFilter,
    )

    const row = rowFor(rows, 'overdue-untimed')
    expect(row.kind === 'occ' && row.showDate).toBe(true)
    expect(estimateRow(row)).toBe(68)
  })

  it('estimates the overdue header at its own height', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), TODAY, NOW, noFilter)

    expect(estimateRow(rows.find(r => r.kind === 'header')!)).toBe(40)
  })

  it('estimates month/week dividers and empty-day rows at their own heights', () => {
    const { rows } = computeAgendaSections(null, [], TODAY, NOW, noFilter)

    expect(estimateRow(rows.find(r => r.kind === 'month')!)).toBe(56)
    expect(estimateRow(rows.find(r => r.kind === 'week')!)).toBe(32)
    expect(estimateRow(rows.find(r => r.kind === 'day-empty')!)).toBe(44)
  })
})
