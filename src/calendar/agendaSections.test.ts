import { describe, it, expect } from 'vitest'
import type { Occurrence, Priority } from '@/types'
import { computeAgendaSections, estimateRow, type Section, type FilterOccs, type AgendaRow } from './agendaSections'
import type { OverdueGroup } from './overduePool'
import { testKey, TEST_VAULT } from '@/test-utils'

const TODAY = new Date(2026, 5, 15) // a Monday
const NOW = new Date(2026, 5, 15, 9, 0)

const noFilter: FilterOccs = occs => occs

// The overdue block is no longer derived from `allOccs` — it arrives as a
// ready-made group list from overduePool.ts (tested in overduePool.test.ts).
// These tests therefore say what the pool found explicitly. One shared empty
// array, not a fresh `[]` per call: computeAgendaSections keys overdue reuse on
// its identity, so a literal would look like a changed input every time.
const noGroups: OverdueGroup[] = []

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
    entryKey: testKey('note.md'),
    id,
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md',
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
const itemIds = (s: Section | undefined) => (s?.kind === 'day' ? s.items.map(o => o.id) : undefined)
const groupKeys = (s: Section | undefined) => (s?.kind === 'overdue' ? s.groups.map(g => g.key) : undefined)
// Type predicates, not bare booleans: `Section` no longer has `items` on both
// variants (overdue carries `groups`), so `Array.find` has to narrow for the
// assertions below to reach either one.
const findDay = (sections: Section[], key: string) =>
  sections.find((s): s is Extract<Section, { kind: 'day' }> => s.kind === 'day' && s.dateKey === key)
const findOverdue = (sections: Section[]) =>
  sections.find((s): s is Extract<Section, { kind: 'overdue' }> => s.kind === 'overdue')

/** One OverdueGroup, shaped the way overduePool.ts builds it. */
function group(o: Occurrence, count = 1): OverdueGroup {
  return { key: o.ownerId ?? o.id, occ: o, count, oldest: o.metadata.jsTime! }
}

const overdueTask = () => occ('overdue-task', '2026-06-10', { done: false })

/** What overduePool.ts would report for baseOccs()' single undone past task. */
const baseGroups = (): OverdueGroup[] => [group(overdueTask())]

// A past event, an overdue task (which now renders on its own past day *and* as
// an overdue group row), two tasks today and one event today, and one future
// event.
function baseOccs(): Occurrence[] {
  return [
    occ('past-event', '2026-06-10', { time: '10:00' }),
    overdueTask(),
    occ('today-event', '2026-06-15', { time: '11:00' }),
    occ('today-task-a', '2026-06-15', { time: '08:00', done: false, priority: 'high' }),
    occ('today-task-b', '2026-06-15', { time: '08:00', done: false, priority: 'low' }),
    occ('future-event', '2026-06-20', { time: '09:00' }),
  ]
}

describe('computeAgendaSections', () => {
  it('lays out past days → overdue → current/future days', () => {
    const { sections, goToIndex } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)

    expect(dayKeys(sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-20'])
    expect(groupKeys(findOverdue(sections))).toEqual(['overdue-task'])
    // The past day keeps *both* its occurrences: undone tasks are no longer
    // hoisted out of their day into the overdue block, so the grouped row above
    // is a summary rather than the only place the task exists.
    expect(itemIds(findDay(sections, '2026-06-10'))).toEqual(['overdue-task', 'past-event'])
    expect(sections[goToIndex]).toBe(findOverdue(sections))
  })

  it('collapses the overdue section to just its header row when overdueCollapsed is true', () => {
    const { sections, goToIndex } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, TODAY, true)

    const overdue = findOverdue(sections)
    // `groups` still carries the full pool — only what's rendered shrinks.
    expect(groupKeys(overdue)).toEqual(['overdue-task'])
    expect(overdue?.rows).toHaveLength(1)
    expect(overdue?.rows[0]).toMatchObject({ kind: 'header', label: 'Overdue', collapsed: true, count: 1 })
    // The scroll target is still the overdue section — collapsed, it's just one row.
    expect(sections[goToIndex]).toBe(overdue)
  })

  it('rebuilds the overdue section when overdueCollapsed flips, even with no occurrence change', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const collapsed = computeAgendaSections(null, all, groups, TODAY, NOW, noFilter, TODAY, true)
    const expanded = computeAgendaSections(collapsed, all, groups, TODAY, NOW, noFilter, TODAY, false)

    expect(expanded).not.toBe(collapsed)
    expect(findOverdue(expanded.sections)?.rows).toHaveLength(2) // header + the one overdue group
    expect(findOverdue(expanded.sections)?.rows[0]).toMatchObject({ collapsed: false, count: 1 })
  })

  it('seeds an empty today section so goToIndex always resolves', () => {
    const { sections, goToIndex } = computeAgendaSections(null, [], noGroups, TODAY, NOW, noFilter)

    expect(dayKeys(sections)).toEqual(['2026-06-15'])
    expect(sections[goToIndex]).toBe(sections[0])
    expect(itemIds(sections[0])).toEqual([])
  })

  it('returns the identical cache when nothing changed', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, noGroups, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, all, noGroups, TODAY, NOW, noFilter)

    expect(second).toBe(first)
  })

  it('reuses every untouched section when one occurrence toggles done', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const first = computeAgendaSections(null, all, groups, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, overlay(all, 'today-task-a', { done: true }), groups, TODAY, NOW, noFilter)

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
    const first = computeAgendaSections(null, all, noGroups, TODAY, NOW, noFilter)
    expect(itemIds(findDay(first.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-a', 'today-task-b'])

    const second = computeAgendaSections(first, overlay(all, 'today-task-a', { done: true }), noGroups, TODAY, NOW, noFilter)
    expect(itemIds(findDay(second.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-b', 'today-task-a'])
    expect(findDay(second.sections, '2026-06-15')?.items[2]!.metadata.done).toBe(true)
  })

  it('drops the overdue block when the pool empties, leaving the task on its own day', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, baseGroups(), TODAY, NOW, noFilter)
    const done = overlay(all, 'overdue-task', { done: true })
    // Completing it empties the pool (overduePool.ts filters done items out).
    const second = computeAgendaSections(first, done, noGroups, TODAY, NOW, noFilter)

    expect(findOverdue(second.sections)).toBeUndefined()
    // Both occurrences are dimmed now, so they cluster event-before-task.
    expect(itemIds(findDay(second.sections, '2026-06-10'))).toEqual(['past-event', 'overdue-task'])
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15', '2026-06-20'])
  })

  it('renders a past day whose only content is an undone task, and keeps it toggleable there', () => {
    // Before the overdue block was grouped, this day vanished entirely: its one
    // occurrence was hoisted into overdue and `section` came back null. With one
    // row per series up top, the day itself is now the only place the individual
    // occurrence can be checked off, so it has to render.
    const all = [occ('lone-overdue', '2026-06-10', { done: false })]
    const first = computeAgendaSections(null, all, [group(all[0]!)], TODAY, NOW, noFilter)
    expect(dayKeys(first.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15'])
    expect(itemIds(findDay(first.sections, '2026-06-10'))).toEqual(['lone-overdue'])

    // Completing it from that day updates the day and empties the pool.
    const second = computeAgendaSections(first, overlay(all, 'lone-overdue', { done: true }), noGroups, TODAY, NOW, noFilter)
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15'])
    expect(findDay(second.sections, '2026-06-10')?.items[0]!.metadata.done).toBe(true)
    expect(second.goToIndex).toBe(1)
  })

  it('keeps every covered day of a multiday event across a metadata change', () => {
    const trip = (day: number) =>
      occ('trip', `2026-06-${day}`, { duration: '3d', jsTime: new Date(2026, 5, day) })
    const all = [trip(16), trip(17), trip(18)]

    const first = computeAgendaSections(null, all, noGroups, TODAY, NOW, noFilter)
    expect(dayKeys(first.sections)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'])

    // The overlay rewrites every occurrence sharing the id — all three days.
    const second = computeAgendaSections(first, overlay(all, 'trip', { priority: 'high' }), noGroups, TODAY, NOW, noFilter)
    expect(dayKeys(second.sections)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'])
    for (const key of ['2026-06-16', '2026-06-17', '2026-06-18']) {
      expect(itemIds(findDay(second.sections, key))).toEqual(['trip'])
    }
  })

  it('re-groups from scratch when an occurrence moves to another day', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const first = computeAgendaSections(null, all, groups, TODAY, NOW, noFilter)

    // Same array length, but future-event jumped a day — the cached buckets
    // must not be reused.
    const moved = all.map(o =>
      o.id === 'future-event' ? occ('future-event', '2026-06-21', { time: '09:00' }) : o)
    const second = computeAgendaSections(first, moved, groups, TODAY, NOW, noFilter)

    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-21'])
    expect(second.keyByIndex).not.toBe(first.keyByIndex)
  })

  it('re-groups from scratch when an occurrence is added or removed', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const first = computeAgendaSections(null, all, groups, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, all.filter(o => o.id !== 'future-event'), groups, TODAY, NOW, noFilter)

    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15'])
  })

  it('rebuilds every section when the clock ticks, but reuses the grouping', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, noGroups, TODAY, NOW, noFilter)
    const later = computeAgendaSections(first, all, noGroups, TODAY, new Date(2026, 5, 15, 12, 0), noFilter)

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
    const { sections } = computeAgendaSections(null, all, noGroups, TODAY, NOW, onlyAlice)

    // 06-21 filters down to nothing and disappears; today is always kept.
    expect(dayKeys(sections)).toEqual(['2026-06-15', '2026-06-20'])
    expect(itemIds(findDay(sections, '2026-06-20'))).toEqual(['mine'])
  })

  it('rebuilds all sections when the filter changes', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, baseGroups(), TODAY, NOW, noFilter)
    const hideTasks: FilterOccs = occs => occs.filter(o => o.metadata.done === undefined)
    // The same filter empties the pool upstream (overduePool applies it too).
    const second = computeAgendaSections(first, all, noGroups, TODAY, NOW, hideTasks)

    expect(findOverdue(second.sections)).toBeUndefined()
    expect(itemIds(findDay(second.sections, '2026-06-15'))).toEqual(['today-event'])
    expect(second.keyByIndex).toBe(first.keyByIndex)
  })

  it('re-groups when today rolls over', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, baseGroups(), TODAY, NOW, noFilter)
    const tomorrow = new Date(2026, 5, 16)
    // Yesterday's two tasks join the pool; the pool itself is recomputed
    // upstream, so the caller hands us the new group list.
    const rolled = [...baseGroups(), group(occ('today-task-a', '2026-06-15', { time: '08:00', done: false, priority: 'high' }))]
    const second = computeAgendaSections(first, all, rolled, tomorrow, new Date(2026, 5, 16, 9, 0), noFilter)

    // 06-15 is a past day now and keeps every occurrence it holds, overdue or not.
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15', '__overdue__', '2026-06-16', '2026-06-20'])
    expect(groupKeys(findOverdue(second.sections))).toEqual(['overdue-task', 'today-task-a'])
    expect(findDay(second.sections, '2026-06-16')?.items).toEqual([])
  })

  it('rebuilds when the locale week-start changes, even with no occurrence change', () => {
    const all = baseOccs()
    const mondayStart = computeAgendaSections(null, all, noGroups, TODAY, NOW, noFilter, TODAY, false, 1)
    const sundayStart = computeAgendaSections(mondayStart, all, noGroups, TODAY, NOW, noFilter, TODAY, false, 0)

    expect(sundayStart).not.toBe(mondayStart)
  })
})

describe('computeAgendaSections — flat rows', () => {
  it('badges only a day\'s first occurrence row; later rows on the same day carry no badge', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)
    // isToday (not just dateKey) excludes the overdue group row, which also
    // carries dateKey '2026-06-15' (see the todayKey comment on
    // overdueGroupRows) but belongs to a different day's own content.
    const todayRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'occ' }> => r.kind === 'occ' && r.dateKey === '2026-06-15' && r.isToday)

    expect(todayRows).toHaveLength(3)
    expect(todayRows.map(r => !!r.badge)).toEqual([true, false, false])
    expect(todayRows[0]!.badge).toEqual({ date: new Date(2026, 5, 15), isToday: true })
  })

  it('emits one overdue-group row per group, carrying its count and oldest date', () => {
    const groups = [group(overdueTask(), 12)]
    const { rows } = computeAgendaSections(null, baseOccs(), groups, TODAY, NOW, noFilter)
    const groupRows = rows.filter(r => r.kind === 'overdue-group')

    expect(groupRows).toHaveLength(1)
    expect(groupRows[0]).toMatchObject({ count: 12, oldest: new Date(2026, 5, 10, 0, 0) })
    expect(groupRows[0]!.occ.id).toBe('overdue-task')
    // Keyed on the group, not on the representative's instant: the row has to
    // survive that occurrence being completed and replaced by the next-oldest.
    expect(groupRows[0]!.key).toBe('og|overdue-task')
  })

  it('groups every occurrence of one series into a single row', () => {
    // What a weekly task left unfinished for a year looks like coming out of
    // overduePool: 156 occurrences, one group, one row.
    const rep = { ...occ('weekly-1', '2025-07-01', { done: false }), ownerId: 'series-a' }
    const { rows } = computeAgendaSections(null, [], [group(rep, 156)], TODAY, NOW, noFilter)
    const groupRows = rows.filter(r => r.kind === 'overdue-group')

    expect(groupRows).toHaveLength(1)
    expect(groupRows[0]).toMatchObject({ key: 'og|series-a', count: 156 })
    expect(rows.find(r => r.kind === 'header')).toMatchObject({ count: 1 })
  })

  it('preserves the past → overdue → current/future order of content rows around the week/month dividers', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)
    const content = rows.filter(r => r.kind !== 'month' && r.kind !== 'week')

    expect(content.map(r => r.kind)).toEqual([
      'occ', 'occ',              // 2026-06-10 (overdue-task, past-event) — both kept, no hoist
      'header', 'overdue-group', // __overdue__
      'occ', 'occ', 'occ',       // 2026-06-15 (today-event, today-task-a, today-task-b)
      'occ',                     // 2026-06-20 (future-event)
    ])
  })

  it("carries todayKey on overdue rows, not each group's own oldest day", () => {
    const { rows } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)

    expect(rows.find(r => r.kind === 'header')?.dateKey).toBe('2026-06-15')
    expect(rows.find(r => r.kind === 'overdue-group')?.dateKey).toBe('2026-06-15')
  })

  it('gives every row a globally-unique key, including a multiday task spanning two past days', () => {
    // A multiday task's occurrences share one id across every day it spans, so
    // a bare-id row key would collide across the flat list. They also collapse
    // into a single overdue group, whose own row key is the group key.
    const day1 = occ('multi-task', '2026-06-10', { done: false })
    const day2 = occ('multi-task', '2026-06-11', { done: false })
    const { rows } = computeAgendaSections(
      null, [day1, day2, ...baseOccs()], [group(day1, 2), ...baseGroups()], TODAY, NOW, noFilter,
    )

    const keys = rows.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)

    const multidayRows = rows.filter(r => r.kind === 'occ' && r.occ.id === 'multi-task')
    expect(multidayRows).toHaveLength(2)
    expect(multidayRows[0]!.key).not.toBe(multidayRows[1]!.key)
    expect(rows.filter(r => r.kind === 'overdue-group' && r.occ.id === 'multi-task')).toHaveLength(1)
  })

  it("points goToRowIndex at the overdue header when present, else at today's own badged row", () => {
    const withOverdue = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)
    const overdueTarget = withOverdue.rows[withOverdue.goToRowIndex]
    expect(overdueTarget?.kind).toBe('header')

    const onlyToday = [occ('today-event', '2026-06-15', { time: '11:00' })]
    const noOverdue = computeAgendaSections(null, onlyToday, noGroups, TODAY, NOW, noFilter)
    const todayTarget = noOverdue.rows[noOverdue.goToRowIndex]
    expect(todayTarget?.kind).toBe('occ')
    expect(todayTarget?.kind === 'occ' && todayTarget.badge?.isToday).toBe(true)
  })

  it('emits a badged day-empty row (not a header) for a forced, contentless anchor day', () => {
    const { rows } = computeAgendaSections(null, [], noGroups, TODAY, NOW, noFilter)
    const todayRow = rows.find(r => r.kind === 'day-empty')

    expect(todayRow?.kind === 'day-empty' && todayRow.isToday).toBe(true)
    expect(todayRow?.kind === 'day-empty' && todayRow.date).toEqual(new Date(2026, 5, 15))
  })
})

describe('computeAgendaSections — month/week dividers', () => {
  it('gives every week in the window a divider row, even ones with nothing scheduled', () => {
    const { rows } = computeAgendaSections(null, [], noGroups, TODAY, NOW, noFilter)
    // [anchor-365, anchor+90] spans a little over 65 weeks.
    expect(rows.filter(r => r.kind === 'week').length).toBeGreaterThan(60)
  })

  it('gives every month in the window a divider row', () => {
    const { rows } = computeAgendaSections(null, [], noGroups, TODAY, NOW, noFilter)
    // ~15-16 calendar months across a 455-day window.
    expect(rows.filter(r => r.kind === 'month').length).toBeGreaterThan(13)
  })

  it('omits the year from a month divider in the current year, includes it for others', () => {
    const { rows } = computeAgendaSections(null, [], noGroups, TODAY, NOW, noFilter)
    const monthRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'month' }> => r.kind === 'month')

    expect(monthRows.find(r => r.label === 'June')).toBeDefined()
    expect(monthRows.find(r => r.label === 'December 2025')).toBeDefined()
  })

  it('labels a week with its ISO week number and date range', () => {
    const { rows } = computeAgendaSections(null, [], noGroups, TODAY, NOW, noFilter)
    const weekRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'week' }> => r.kind === 'week')

    // TODAY (2026-06-15) is a Monday, so its own week starts on it.
    const todaysWeek = weekRows.find(r => r.dateKey === '2026-06-15')
    expect(todaysWeek?.label).toMatch(/^Week \d+, Jun 15 – 21$/)
  })

  it('places the month/week dividers before the day content that falls inside them', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)
    const todayOccIndex = rows.findIndex(r => r.kind === 'occ' && r.dateKey === '2026-06-15')
    const precedingWeek = [...rows.slice(0, todayOccIndex)].reverse().find(r => r.kind === 'week')
    expect(precedingWeek?.dateKey).toBe('2026-06-15')
  })
})

describe('computeAgendaSections — anchor', () => {
  it('defaults to today, preserving the overdue-preferring scroll target', () => {
    const { goToRowIndex, rows } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('header')
  })

  it('targets a day with content directly when anchored there, ignoring overdue', () => {
    const anchor = new Date(2026, 5, 20) // future-event's own day
    const { sections, rows, goToRowIndex } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, anchor)

    expect(dayKeys(sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-20'])
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('occ')
    expect(target?.dateKey).toBe('2026-06-20')
  })

  it('force-renders an empty section at the anchor — future or past — purely as a scroll target', () => {
    const futureAnchor = new Date(2026, 5, 25) // no occurrences on this day
    const future = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, futureAnchor)
    expect(dayKeys(future.sections)).toContain('2026-06-25')
    const futureTarget = future.sections[future.goToIndex]
    expect(futureTarget?.kind === 'day' && futureTarget.items).toEqual([])

    const pastAnchor = new Date(2026, 5, 5) // before any occurrence, and before today
    const past = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, pastAnchor)
    expect(dayKeys(past.sections)).toContain('2026-06-05')
    const pastTarget = past.sections[past.goToIndex]
    expect(pastTarget?.kind === 'day' && pastTarget.items).toEqual([])
  })

  it('does not force-render an empty today section when anchored elsewhere', () => {
    const anchor = new Date(2026, 5, 20)
    const onlyFuture = [occ('future-event', '2026-06-20', { time: '09:00' })]
    const { sections } = computeAgendaSections(null, onlyFuture, noGroups, TODAY, NOW, noFilter, anchor)

    expect(dayKeys(sections)).toEqual(['2026-06-20'])
  })

  it('re-groups from scratch when only the anchor changes', () => {
    const all = baseOccs()
    const first = computeAgendaSections(null, all, noGroups, TODAY, NOW, noFilter)
    const second = computeAgendaSections(first, all, noGroups, TODAY, NOW, noFilter, new Date(2026, 5, 20))

    expect(second).not.toBe(first)
    expect(second.rows[second.goToRowIndex]?.dateKey).toBe('2026-06-20')
  })

  it('still splices in the overdue rows when the anchor is far enough away that today falls outside the window', () => {
    const all = baseOccs()
    const farAnchor = new Date(2027, 5, 15) // 365 days ahead of TODAY — well outside [anchor-365, anchor+90]
    const { rows } = computeAgendaSections(null, all, baseGroups(), TODAY, NOW, noFilter, farAnchor)

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
      noGroups, TODAY, NOW, noFilter,
    )

    // No badge at all — the card sits on its min-h-11 floor.
    expect(estimateRow(rowFor(rows, 'untimed'))).toBe(50)
    // A time badge or a duration chip each force the meta row.
    expect(estimateRow(rowFor(rows, 'timed'))).toBe(68)
    expect(estimateRow(rowFor(rows, 'with-duration'))).toBe(68)
  })

  it('estimates an overdue group row at the meta height — it always shows a date badge', () => {
    const untimed = occ('overdue-untimed', '2026-06-10', { done: false })
    const { rows } = computeAgendaSections(null, [untimed], [group(untimed)], TODAY, NOW, noFilter)

    expect(estimateRow(rows.find(r => r.kind === 'overdue-group')!)).toBe(68)
  })

  it('estimates the overdue header at its own height', () => {
    const { rows } = computeAgendaSections(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter)

    expect(estimateRow(rows.find(r => r.kind === 'header')!)).toBe(40)
  })

  it('estimates month/week dividers and empty-day rows at their own heights', () => {
    const { rows } = computeAgendaSections(null, [], noGroups, TODAY, NOW, noFilter)

    expect(estimateRow(rows.find(r => r.kind === 'month')!)).toBe(60)
    expect(estimateRow(rows.find(r => r.kind === 'week')!)).toBe(36)
    expect(estimateRow(rows.find(r => r.kind === 'day-empty')!)).toBe(56)
  })
})
