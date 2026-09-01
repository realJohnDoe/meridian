import { describe, it, expect } from 'vitest'
import type { Occurrence, Priority } from '@/types'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import {
  computeAgendaSections, estimateRow,
  type AgendaChunkOccs, type AgendaSectionCache, type Section, type FilterOccs, type AgendaRow,
} from './agendaSections'
import { agendaChunkRun, chunkIndexFor, chunkRange, chunkIndicesFor, EXPAND_PAST_DAYS, EXPAND_FUTURE_DAYS } from './agendaChunks'
import { weekStartFor } from './weekRange'
import { sortOccs } from './occSort'
import type { OverdueGroup } from './overduePool'
import { testKey, TEST_VAULT } from '@/test-utils'

const TODAY = new Date(2026, 5, 15) // a Monday
const NOW = new Date(2026, 5, 15, 9, 0)

const noFilter: FilterOccs = occs => occs

/**
 * The run these tests default to when a span doesn't specify its own — the
 * old fixed [anchor-EXPAND_PAST_DAYS, anchor+EXPAND_FUTURE_DAYS] window,
 * reproduced locally rather than via `agendaChunkRun` (which now just turns
 * an already-decided `{first, last}` range into an index list; the loaded
 * run itself is session-scoped state owned by `calendar/viewState.ts`). What
 * this file actually tests, `computeAgendaSections`, takes `chunkOccs`
 * directly and has never cared how the run was decided — a wide run is simply
 * the one that best exercises the chunk-boundary invariants below.
 */
function testRun(anchor: Date, ws: 0 | 1 | 6): number[] {
  return chunkIndicesFor(addDays(anchor, -EXPAND_PAST_DAYS), addDays(anchor, EXPAND_FUTURE_DAYS), ws)
}

// The overdue block is no longer derived from the agenda's occurrences — it
// arrives as a ready-made group list from overduePool.ts (tested in
// overduePool.test.ts). These tests therefore say what the pool found
// explicitly. One shared empty array, not a fresh `[]` per call:
// computeAgendaSections keys overdue reuse on its identity, so a literal would
// look like a changed input every time.
const noGroups: OverdueGroup[] = []

// computeAgendaSections keys its per-chunk caches on filter *state*, not on
// the callback's identity (see useCalendarFilter's describeFilter). These
// tests only ever have one filter behaviour per function, so deriving a
// stable key per function reproduces exactly that: same filter, same key.
const filterKeys = new WeakMap<FilterOccs, string>()
let nextFilterKey = 0
function keyOf(filter: FilterOccs): string {
  let key = filterKeys.get(filter)
  if (key === undefined) {
    key = `filter-${nextFilterKey++}`
    filterKeys.set(filter, key)
  }
  return key
}

/**
 * What useAgendaChunks hands computeAgendaSections: the anchor's chunk run,
 * with each chunk carrying only the occurrences that fall inside it.
 *
 * Memoized on `(occs, anchor, ws)` for the same reason the hook memoizes its
 * own result — the identity-based cache assertions below are only meaningful
 * if an unchanged input arrives as an unchanged array.
 */
const chunkMemo = new WeakMap<Occurrence[], Map<string, AgendaChunkOccs[]>>()
function chunksOf(occs: Occurrence[], anchor: Date, ws: 0 | 1 | 6 = 1, range?: number[]): AgendaChunkOccs[] {
  let byWindow = chunkMemo.get(occs)
  if (!byWindow) { byWindow = new Map(); chunkMemo.set(occs, byWindow) }
  const indices = range ?? testRun(anchor, ws)
  const memoKey = `${anchor.getTime()}|${ws}|${indices.join(',')}`
  const cached = byWindow.get(memoKey)
  if (cached) return cached

  const run = indices.map(index => {
    const { from, to } = chunkRange(index, ws)
    return {
      index,
      occs: occs.filter(o => {
        const t = o.metadata.jsTime
        return !!t && t >= from && t <= to
      }),
    }
  })
  byWindow.set(memoKey, run)
  return run
}

/** computeAgendaSections with the chunking plumbing filled in from a flat list.
 * `range` overrides the default (old, full-window-sized) run — see spans below. */
function compute(
  prev: AgendaSectionCache | null,
  occs: Occurrence[],
  groups: OverdueGroup[],
  today: Date = TODAY,
  now: Date = NOW,
  filter: FilterOccs = noFilter,
  anchor: Date = today,
  overdueCollapsed = false,
  ws: 0 | 1 | 6 = 1,
  range?: number[],
): AgendaSectionCache {
  return computeAgendaSections(
    prev, chunksOf(occs, anchor, ws, range), groups, today, now, filter, keyOf(filter), anchor, overdueCollapsed, ws,
  )
}

/** The inclusive first/last day of the run `compute` walks for `anchor`. */
function runDays(anchor: Date, ws: 0 | 1 | 6 = 1, range?: number[]): Date[] {
  const indices = range ?? testRun(anchor, ws)
  const from = chunkRange(indices[0]!, ws).from
  const days: Date[] = []
  for (let i = 0; i < indices.length * 28; i++) days.push(addDays(from, i))
  return days
}

/**
 * The row list a *single continuous walk* over the whole run produces — the
 * pre-chunking algorithm, written out independently here so the chunked
 * implementation can be checked against it rather than against itself.
 *
 * Row keys only: identity is what everything downstream (getItemKey,
 * useVirtualFlip, computeAgendaScrollRestore's measurement snapshot) actually
 * consumes, and comparing them catches a misplaced divider, a duplicated one
 * at a chunk boundary, a dropped day and a mis-spliced overdue block alike.
 */
function singlePassRowKeys(
  occs: Occurrence[],
  groups: OverdueGroup[],
  today: Date = TODAY,
  now: Date = NOW,
  filter: FilterOccs = noFilter,
  anchor: Date = today,
  overdueCollapsed = false,
  ws: 0 | 1 | 6 = 1,
  range?: number[],
): string[] {
  const days = runDays(anchor, ws, range)
  const from = days[0]!, to = days[days.length - 1]!
  const todayKey = fmtISO(today)
  const anchorKey = fmtISO(anchor)

  const byDay = new Map<string, Occurrence[]>()
  for (const o of occs) {
    const t = o.metadata.jsTime
    if (!t || t < from || t >= addDays(to, 1)) continue
    const key = fmtISO(t)
    const bucket = byDay.get(key)
    if (bucket) bucket.push(o)
    else byDay.set(key, [o])
  }

  const overdueRows = groups.length === 0
    ? []
    : overdueCollapsed
      ? ['h|__overdue__']
      : ['h|__overdue__', ...groups.map(g => `og|${g.key}`)]
  // Today, clamped into the run — the same "one end of the window rather than
  // nowhere" rule the assembly applies.
  const overdueDayKey = fmtISO(new Date(Math.max(from.getTime(), Math.min(today.getTime(), to.getTime()))))

  // The run's first divider mirrors assembleAgendaRows' leading-divider
  // special case: keyed off the opening chunk's own index (`|lead`) rather
  // than the bare month whenever the run starts mid-month, so it can never
  // collide with the *real* divider a later backward-grown chunk emits for
  // that same month's true 1st — see monthDividerRow's own note.
  const indices = range ?? testRun(anchor, ws)
  const firstChunkIndex = indices[0]!
  const firstDay = days[0]!
  const isLeadingMidMonth = fmtISO(firstDay).slice(0, 7) === fmtISO(addDays(firstDay, -1)).slice(0, 7)

  const out: string[] = []
  let lastMonthKey = ''
  let lastWeekKey = ''
  for (const day of days) {
    const dateKey = fmtISO(day)
    const monthKey = `${day.getFullYear()}-${day.getMonth()}`
    if (monthKey !== lastMonthKey) {
      lastMonthKey = monthKey
      const isLeading = out.length === 0
      out.push(isLeading && isLeadingMidMonth ? `m|${monthKey}|lead${firstChunkIndex}` : `m|${monthKey}`)
    }
    const weekKey = fmtISO(weekStartFor(day, ws))
    if (weekKey !== lastWeekKey) { lastWeekKey = weekKey; out.push(`w|${weekKey}`) }

    if (overdueRows.length && dateKey === overdueDayKey) out.push(...overdueRows)

    const items = sortOccs(filter(byDay.get(dateKey) ?? []), now)
    if (items.length) {
      for (const o of items) out.push(`${dateKey}|${o.id}|${o.metadata.jsTime?.getTime() ?? ''}`)
    } else if (dateKey === anchorKey || (dateKey === todayKey && anchorKey === todayKey)) {
      out.push(`e|${dateKey}`)
    }
  }
  return out
}

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

/** The per-chunk row cache the day `dateKey` belongs to. */
const chunkFor = (cache: AgendaSectionCache, dateKey: string, ws: 0 | 1 | 6 = 1) =>
  cache.chunks.get(chunkIndexFor(new Date(`${dateKey}T00:00:00`), ws))!

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
    const { sections, goToIndex } = compute(null, baseOccs(), baseGroups())

    expect(dayKeys(sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-20'])
    expect(groupKeys(findOverdue(sections))).toEqual(['overdue-task'])
    // The past day keeps *both* its occurrences: undone tasks are no longer
    // hoisted out of their day into the overdue block, so the grouped row above
    // is a summary rather than the only place the task exists.
    expect(itemIds(findDay(sections, '2026-06-10'))).toEqual(['overdue-task', 'past-event'])
    expect(sections[goToIndex]).toBe(findOverdue(sections))
  })

  it('collapses the overdue section to just its header row when overdueCollapsed is true', () => {
    const { sections, goToIndex } = compute(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, TODAY, true)

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
    const collapsed = compute(null, all, groups, TODAY, NOW, noFilter, TODAY, true)
    const expanded = compute(collapsed, all, groups, TODAY, NOW, noFilter, TODAY, false)

    expect(expanded).not.toBe(collapsed)
    expect(findOverdue(expanded.sections)?.rows).toHaveLength(2) // header + the one overdue group
    expect(findOverdue(expanded.sections)?.rows[0]).toMatchObject({ collapsed: false, count: 1 })
  })

  it('seeds an empty today section so goToIndex always resolves', () => {
    const { sections, goToIndex } = compute(null, [], noGroups)

    expect(dayKeys(sections)).toEqual(['2026-06-15'])
    expect(sections[goToIndex]).toBe(sections[0])
    expect(itemIds(sections[0])).toEqual([])
  })

  it('returns the identical cache when nothing changed', () => {
    const all = baseOccs()
    const first = compute(null, all, noGroups)
    const second = compute(first, all, noGroups)

    expect(second).toBe(first)
  })

  it('reuses every untouched section when one occurrence toggles done', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const first = compute(null, all, groups)
    const second = compute(first, overlay(all, 'today-task-a', { done: true }), groups)

    expect(second).not.toBe(first)
    // Only today's section is rebuilt; the past day, the overdue pool and the
    // future day are handed back by reference (this is what stops AgendaRow
    // from re-rendering the rest of the vault).
    expect(findDay(second.sections, '2026-06-10')).toBe(findDay(first.sections, '2026-06-10'))
    expect(findDay(second.sections, '2026-06-20')).toBe(findDay(first.sections, '2026-06-20'))
    expect(findOverdue(second.sections)).toBe(findOverdue(first.sections))
    expect(findDay(second.sections, '2026-06-15')).not.toBe(findDay(first.sections, '2026-06-15'))
    // The grouping itself survived — no re-bucketing.
    expect(chunkFor(second, '2026-06-15').keyByIndex).toBe(chunkFor(first, '2026-06-15').keyByIndex)
    expect(chunkFor(second, '2026-06-15').sortedKeys).toBe(chunkFor(first, '2026-06-15').sortedKeys)
    // Untouched sections' `rows` arrays are reference-stable too — this is
    // what lets a flat-list virtualizer skip remeasuring rows the toggle
    // didn't touch (see the AgendaRow doc comment in agendaSections.ts).
    expect(findDay(second.sections, '2026-06-10')?.rows).toBe(findDay(first.sections, '2026-06-10')?.rows)
    expect(findDay(second.sections, '2026-06-20')?.rows).toBe(findDay(first.sections, '2026-06-20')?.rows)
    expect(findOverdue(second.sections)?.rows).toBe(findOverdue(first.sections)?.rows)
  })

  it('re-sorts the touched day so a completed task sinks below the open one', () => {
    const all = baseOccs()
    const first = compute(null, all, noGroups)
    expect(itemIds(findDay(first.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-a', 'today-task-b'])

    const second = compute(first, overlay(all, 'today-task-a', { done: true }), noGroups)
    expect(itemIds(findDay(second.sections, '2026-06-15'))).toEqual(['today-event', 'today-task-b', 'today-task-a'])
    expect(findDay(second.sections, '2026-06-15')?.items[2]!.metadata.done).toBe(true)
  })

  it('drops the overdue block when the pool empties, leaving the task on its own day', () => {
    const all = baseOccs()
    const first = compute(null, all, baseGroups())
    const done = overlay(all, 'overdue-task', { done: true })
    // Completing it empties the pool (overduePool.ts filters done items out).
    const second = compute(first, done, noGroups)

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
    const first = compute(null, all, [group(all[0]!)])
    expect(dayKeys(first.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15'])
    expect(itemIds(findDay(first.sections, '2026-06-10'))).toEqual(['lone-overdue'])

    // Completing it from that day updates the day and empties the pool.
    const second = compute(first, overlay(all, 'lone-overdue', { done: true }), noGroups)
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15'])
    expect(findDay(second.sections, '2026-06-10')?.items[0]!.metadata.done).toBe(true)
    expect(second.goToIndex).toBe(1)
  })

  it('keeps every covered day of a multiday event across a metadata change', () => {
    const trip = (day: number) =>
      occ('trip', `2026-06-${day}`, { duration: '3d', jsTime: new Date(2026, 5, day) })
    const all = [trip(16), trip(17), trip(18)]

    const first = compute(null, all, noGroups)
    expect(dayKeys(first.sections)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'])

    // The overlay rewrites every occurrence sharing the id — all three days.
    const second = compute(first, overlay(all, 'trip', { priority: 'high' }), noGroups)
    expect(dayKeys(second.sections)).toEqual(['2026-06-15', '2026-06-16', '2026-06-17', '2026-06-18'])
    for (const key of ['2026-06-16', '2026-06-17', '2026-06-18']) {
      expect(itemIds(findDay(second.sections, key))).toEqual(['trip'])
    }
  })

  it('re-groups from scratch when an occurrence moves to another day', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const first = compute(null, all, groups)

    // Same array length, but future-event jumped a day — the cached buckets
    // must not be reused.
    const moved = all.map(o =>
      o.id === 'future-event' ? occ('future-event', '2026-06-21', { time: '09:00' }) : o)
    const second = compute(first, moved, groups)

    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-21'])
    expect(chunkFor(second, '2026-06-20').keyByIndex).not.toBe(chunkFor(first, '2026-06-20').keyByIndex)
  })

  it('re-groups from scratch when an occurrence is added or removed', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const first = compute(null, all, groups)
    const second = compute(first, all.filter(o => o.id !== 'future-event'), groups)

    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15'])
  })

  it('rebuilds every section when the clock ticks, but reuses the grouping', () => {
    const all = baseOccs()
    const first = compute(null, all, noGroups)
    const later = compute(first, all, noGroups, TODAY, new Date(2026, 5, 15, 12, 0))

    expect(chunkFor(later, '2026-06-15').keyByIndex).toBe(chunkFor(first, '2026-06-15').keyByIndex)
    // today-event (11:00) is now in the past, so it sinks into the dimmed group.
    expect(itemIds(findDay(later.sections, '2026-06-15'))).toEqual(['today-task-a', 'today-task-b', 'today-event'])
  })

  it('applies the calendar filter per day and drops days it empties', () => {
    const all = [
      occ('mine', '2026-06-20', { time: '09:00', participants: ['alice'] }),
      occ('theirs', '2026-06-21', { time: '09:00', participants: ['bob'] }),
    ]
    const onlyAlice: FilterOccs = occs => occs.filter(o => o.metadata.participants.includes('alice'))
    const { sections } = compute(null, all, noGroups, TODAY, NOW, onlyAlice)

    // 06-21 filters down to nothing and disappears; today is always kept.
    expect(dayKeys(sections)).toEqual(['2026-06-15', '2026-06-20'])
    expect(itemIds(findDay(sections, '2026-06-20'))).toEqual(['mine'])
  })

  it('rebuilds all sections when the filter changes', () => {
    const all = baseOccs()
    const first = compute(null, all, baseGroups())
    const hideTasks: FilterOccs = occs => occs.filter(o => o.metadata.done === undefined)
    // The same filter empties the pool upstream (overduePool applies it too).
    const second = compute(first, all, noGroups, TODAY, NOW, hideTasks)

    expect(findOverdue(second.sections)).toBeUndefined()
    expect(itemIds(findDay(second.sections, '2026-06-15'))).toEqual(['today-event'])
    expect(chunkFor(second, '2026-06-15').keyByIndex).toBe(chunkFor(first, '2026-06-15').keyByIndex)
  })

  it('re-groups when today rolls over', () => {
    const all = baseOccs()
    const first = compute(null, all, baseGroups())
    const tomorrow = new Date(2026, 5, 16)
    // Yesterday's two tasks join the pool; the pool itself is recomputed
    // upstream, so the caller hands us the new group list.
    const rolled = [...baseGroups(), group(occ('today-task-a', '2026-06-15', { time: '08:00', done: false, priority: 'high' }))]
    const second = compute(first, all, rolled, tomorrow, new Date(2026, 5, 16, 9, 0))

    // 06-15 is a past day now and keeps every occurrence it holds, overdue or not.
    expect(dayKeys(second.sections)).toEqual(['2026-06-10', '2026-06-15', '__overdue__', '2026-06-16', '2026-06-20'])
    expect(groupKeys(findOverdue(second.sections))).toEqual(['overdue-task', 'today-task-a'])
    expect(findDay(second.sections, '2026-06-16')?.items).toEqual([])
  })

  it('rebuilds when the locale week-start changes, even with no occurrence change', () => {
    const all = baseOccs()
    const mondayStart = compute(null, all, noGroups, TODAY, NOW, noFilter, TODAY, false, 1)
    const sundayStart = compute(mondayStart, all, noGroups, TODAY, NOW, noFilter, TODAY, false, 0)

    expect(sundayStart).not.toBe(mondayStart)
    expect(sundayStart.rows.map(r => r.key)).toEqual(singlePassRowKeys(all, noGroups, TODAY, NOW, noFilter, TODAY, false, 0))
  })
})

describe('computeAgendaSections — chunk-local sectioning', () => {
  // The property the whole split rests on: where a chunk boundary happens to
  // fall must not be observable in the result. Anything that leaked across one
  // — a divider emitted twice, a divider not emitted at all because the chunk
  // couldn't see its predecessor, a day's rows landing in the wrong order
  // around the overdue splice — shows up here as a diverging key list.
  const spans: [string, { anchor: Date; occs: Occurrence[]; groups: OverdueGroup[]; range?: number[] }][] = [
    ['the default anchor, with overdue', { anchor: TODAY, occs: baseOccs(), groups: baseGroups() }],
    ['the default anchor, no overdue', { anchor: TODAY, occs: baseOccs(), groups: noGroups }],
    ['an empty vault', { anchor: TODAY, occs: [], groups: noGroups }],
    ['a future anchor a fortnight out', { anchor: new Date(2026, 5, 29), occs: baseOccs(), groups: baseGroups() }],
    ['a past anchor', { anchor: new Date(2026, 2, 3), occs: baseOccs(), groups: baseGroups() }],
    // Far enough ahead that today is outside the run entirely, so the overdue
    // block clamps to the run's first day instead of splicing at today's.
    ['an anchor far enough out that overdue clamps', { anchor: addDays(TODAY, 500), occs: baseOccs(), groups: baseGroups() }],
    // The runs incremental loading actually produces (see viewState.ts's
    // agendaLoadedChunks): a bare three-chunk first-paint seed, and a run
    // grown asymmetrically further back than forward — the shape "Load
    // earlier" leaves behind. Both are far narrower than every span above,
    // which is exactly what the boundary invariants here need to hold for too.
    ['a bare three-chunk first-paint seed', {
      anchor: TODAY, occs: baseOccs(), groups: baseGroups(),
      range: agendaChunkRun({ first: chunkIndexFor(TODAY, 1) - 1, last: chunkIndexFor(TODAY, 1) + 1 }),
    }],
    ['a run grown backward twice and forward not at all', {
      anchor: TODAY, occs: baseOccs(), groups: baseGroups(),
      range: agendaChunkRun({ first: chunkIndexFor(TODAY, 1) - 3, last: chunkIndexFor(TODAY, 1) }),
    }],
  ]

  for (const [name, { anchor, occs, groups, range }] of spans) {
    it(`assembles the same rows a single continuous walk would — ${name}`, () => {
      const { rows } = compute(null, occs, groups, TODAY, NOW, noFilter, anchor, false, 1, range)
      expect(rows.map(r => r.key)).toEqual(singlePassRowKeys(occs, groups, TODAY, NOW, noFilter, anchor, false, 1, range))
    })
  }

  it('emits each month/week divider exactly once, with none duplicated at a chunk boundary', () => {
    const { rows } = compute(null, baseOccs(), baseGroups())
    const dividers = rows.filter(r => r.kind === 'month' || r.kind === 'week').map(r => r.key)

    expect(new Set(dividers).size).toBe(dividers.length)
    // Every chunk boundary is a week start (the grid is 28 = 4 × 7 days
    // anchored on one), so each contributes exactly one week divider — never
    // two, and never none because the chunk couldn't see its predecessor.
    for (const index of testRun(TODAY, 1)) {
      const firstDay = fmtISO(chunkRange(index, 1).from)
      expect(dividers.filter(k => k === `w|${firstDay}`)).toHaveLength(1)
    }
  })

  it('opens the run with a month divider even though the run starts mid-month', () => {
    const { rows } = compute(null, [], noGroups)
    const firstDay = chunkRange(testRun(TODAY, 1)[0]!, 1).from

    // A chunk emits a month divider only where the month turns over, so this
    // one is the assembly's own leading row — the agenda's top row has always
    // been a month label, and a chunk boundary is essentially never a month start.
    expect(firstDay.getDate()).not.toBe(1)
    expect(rows[0]).toMatchObject({ kind: 'month', dateKey: fmtISO(firstDay) })
    expect(rows[1]).toMatchObject({ kind: 'week', key: `w|${fmtISO(firstDay)}` })
  })

  it('rebuilds only the chunk a done-toggle landed in, handing every other chunk back by reference', () => {
    const all = baseOccs()
    const groups = baseGroups()
    const first = compute(null, all, groups)
    const second = compute(first, overlay(all, 'today-task-a', { done: true }), groups)

    const touched = chunkIndexFor(TODAY, 1)
    const rebuilt = [...second.chunks.entries()].filter(([i, c]) => c.rows !== first.chunks.get(i)?.rows)
    expect(rebuilt.map(([i]) => i)).toEqual([touched])
    // Every other chunk keeps its whole row array — that is what makes a
    // toggle O(one chunk) rather than O(the loaded run).
    expect(second.chunks.size).toBe(testRun(TODAY, 1).length)
  })

  it('rebuilds only the affected chunk when an occurrence is added, instead of dropping the whole cache', () => {
    // The length change that used to invalidate everything (`changedIndices`
    // returns null the moment the lengths differ) is now scoped to one chunk.
    const all = baseOccs()
    const first = compute(null, all, noGroups)
    const second = compute(first, [...all, occ('new-one', '2026-03-04', { time: '09:00' })], noGroups)

    const touched = chunkIndexFor(new Date(2026, 2, 4), 1)
    const rebuilt = [...second.chunks.entries()].filter(([i, c]) => c.rows !== first.chunks.get(i)?.rows)
    expect(rebuilt.map(([i]) => i)).toEqual([touched])
  })

  it('keeps every chunk the anchor did not move through when the agenda re-centers', () => {
    const all = baseOccs()
    const first = compute(null, all, noGroups)
    // A jump inside the same run: the chunks that stay loaded and never held
    // the anchor keep their rows, so only the grid's edges pay for the move.
    const jumped = compute(first, all, noGroups, TODAY, NOW, noFilter, new Date(2026, 6, 20))

    const shared = testRun(TODAY, 1).filter(i => jumped.chunks.has(i))
    const reused = shared.filter(i => jumped.chunks.get(i)!.rows === first.chunks.get(i)!.rows)
    expect(reused.length).toBeGreaterThan(shared.length - 4)
  })

  it('gives every row a chunk-independent key, so the same day keys the same rows under a different anchor', () => {
    const all = baseOccs()
    const here = compute(null, all, noGroups)
    const jumped = compute(null, all, noGroups, TODAY, NOW, noFilter, new Date(2026, 6, 20))

    const keysFor = (cache: AgendaSectionCache, dateKey: string) =>
      cache.rows.filter(r => r.kind === 'occ' && r.dateKey === dateKey).map(r => r.key)
    expect(keysFor(jumped, '2026-06-20')).toEqual(keysFor(here, '2026-06-20'))
  })

  it('reuses the assembled row array when nothing but the occurrence array identity changed', () => {
    // What the once-a-minute `now` tick looks like when it lands inside the
    // same bucketed minute: fresh input arrays, identical content. If assembly
    // allocated regardless, useAnchoredAgendaScroll would read it as a rebuild
    // and re-pin the scroll position.
    const all = baseOccs()
    const first = compute(null, all, noGroups)
    const second = compute(first, [...all], noGroups)

    expect(second).not.toBe(first)
    expect(second.rows).toBe(first.rows)
    expect(second.goToRowIndex).toBe(first.goToRowIndex)
  })
})

describe('computeAgendaSections — flat rows', () => {
  it('badges only a day\'s first occurrence row; later rows on the same day carry no badge', () => {
    const { rows } = compute(null, baseOccs(), baseGroups())
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
    const { rows } = compute(null, baseOccs(), groups)
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
    const { rows } = compute(null, [], [group(rep, 156)])
    const groupRows = rows.filter(r => r.kind === 'overdue-group')

    expect(groupRows).toHaveLength(1)
    expect(groupRows[0]).toMatchObject({ key: 'og|series-a', count: 156 })
    expect(rows.find(r => r.kind === 'header')).toMatchObject({ count: 1 })
  })

  it('preserves the past → overdue → current/future order of content rows around the week/month dividers', () => {
    const { rows } = compute(null, baseOccs(), baseGroups())
    const content = rows.filter(r => r.kind !== 'month' && r.kind !== 'week')

    expect(content.map(r => r.kind)).toEqual([
      'occ', 'occ',              // 2026-06-10 (overdue-task, past-event) — both kept, no hoist
      'header', 'overdue-group', // __overdue__
      'occ', 'occ', 'occ',       // 2026-06-15 (today-event, today-task-a, today-task-b)
      'occ',                     // 2026-06-20 (future-event)
    ])
  })

  it("carries todayKey on overdue rows, not each group's own oldest day", () => {
    const { rows } = compute(null, baseOccs(), baseGroups())

    expect(rows.find(r => r.kind === 'header')?.dateKey).toBe('2026-06-15')
    expect(rows.find(r => r.kind === 'overdue-group')?.dateKey).toBe('2026-06-15')
  })

  it('gives every row a globally-unique key, including a multiday task spanning two past days', () => {
    // A multiday task's occurrences share one id across every day it spans, so
    // a bare-id row key would collide across the flat list. They also collapse
    // into a single overdue group, whose own row key is the group key.
    const day1 = occ('multi-task', '2026-06-10', { done: false })
    const day2 = occ('multi-task', '2026-06-11', { done: false })
    const { rows } = compute(null, [day1, day2, ...baseOccs()], [group(day1, 2), ...baseGroups()])

    const keys = rows.map(r => r.key)
    expect(new Set(keys).size).toBe(keys.length)

    const multidayRows = rows.filter(r => r.kind === 'occ' && r.occ.id === 'multi-task')
    expect(multidayRows).toHaveLength(2)
    expect(multidayRows[0]!.key).not.toBe(multidayRows[1]!.key)
    expect(rows.filter(r => r.kind === 'overdue-group' && r.occ.id === 'multi-task')).toHaveLength(1)
  })

  it("points goToRowIndex at the overdue header when present, else at today's own badged row", () => {
    const withOverdue = compute(null, baseOccs(), baseGroups())
    const overdueTarget = withOverdue.rows[withOverdue.goToRowIndex]
    expect(overdueTarget?.kind).toBe('header')

    const onlyToday = [occ('today-event', '2026-06-15', { time: '11:00' })]
    const noOverdue = compute(null, onlyToday, noGroups)
    const todayTarget = noOverdue.rows[noOverdue.goToRowIndex]
    expect(todayTarget?.kind).toBe('occ')
    expect(todayTarget?.kind === 'occ' && todayTarget.badge?.isToday).toBe(true)
  })

  it('emits a badged day-empty row (not a header) for a forced, contentless anchor day', () => {
    const { rows } = compute(null, [], noGroups)
    const todayRow = rows.find(r => r.kind === 'day-empty')

    expect(todayRow?.kind === 'day-empty' && todayRow.isToday).toBe(true)
    expect(todayRow?.kind === 'day-empty' && todayRow.date).toEqual(new Date(2026, 5, 15))
  })
})

describe('computeAgendaSections — month/week dividers', () => {
  it('gives every week in the window a divider row, even ones with nothing scheduled', () => {
    const { rows } = compute(null, [], noGroups)
    // The run spans a little over 65 weeks — [anchor-365, anchor+90] rounded
    // out to whole 28-day chunks.
    expect(rows.filter(r => r.kind === 'week').length).toBeGreaterThan(60)
  })

  it('gives every month in the window a divider row', () => {
    const { rows } = compute(null, [], noGroups)
    // ~15-16 calendar months across the run.
    expect(rows.filter(r => r.kind === 'month').length).toBeGreaterThan(13)
  })

  it('omits the year from a month divider in the current year, includes it for others', () => {
    const { rows } = compute(null, [], noGroups)
    const monthRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'month' }> => r.kind === 'month')

    expect(monthRows.find(r => r.label === 'June')).toBeDefined()
    expect(monthRows.find(r => r.label === 'December 2025')).toBeDefined()
  })

  it('labels a week with its ISO week number and date range', () => {
    const { rows } = compute(null, [], noGroups)
    const weekRows = rows.filter((r): r is Extract<AgendaRow, { kind: 'week' }> => r.kind === 'week')

    // TODAY (2026-06-15) is a Monday, so its own week starts on it.
    const todaysWeek = weekRows.find(r => r.dateKey === '2026-06-15')
    expect(todaysWeek?.label).toMatch(/^Week \d+, Jun 15 – 21$/)
  })

  it('places the month/week dividers before the day content that falls inside them', () => {
    const { rows } = compute(null, baseOccs(), baseGroups())
    const todayOccIndex = rows.findIndex(r => r.kind === 'occ' && r.dateKey === '2026-06-15')
    const precedingWeek = [...rows.slice(0, todayOccIndex)].reverse().find(r => r.kind === 'week')
    expect(precedingWeek?.dateKey).toBe('2026-06-15')
  })
})

describe('computeAgendaSections — anchor', () => {
  it('defaults to today, preserving the overdue-preferring scroll target', () => {
    const { goToRowIndex, rows } = compute(null, baseOccs(), baseGroups())
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('header')
  })

  it('targets a day with content directly when anchored there, ignoring overdue', () => {
    const anchor = new Date(2026, 5, 20) // future-event's own day
    const { sections, rows, goToRowIndex } = compute(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, anchor)

    expect(dayKeys(sections)).toEqual(['2026-06-10', '__overdue__', '2026-06-15', '2026-06-20'])
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('occ')
    expect(target?.dateKey).toBe('2026-06-20')
  })

  it('force-renders an empty section at the anchor — future or past — purely as a scroll target', () => {
    const futureAnchor = new Date(2026, 5, 25) // no occurrences on this day
    const future = compute(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, futureAnchor)
    expect(dayKeys(future.sections)).toContain('2026-06-25')
    const futureTarget = future.sections[future.goToIndex]
    expect(futureTarget?.kind === 'day' && futureTarget.items).toEqual([])

    const pastAnchor = new Date(2026, 5, 5) // before any occurrence, and before today
    const past = compute(null, baseOccs(), baseGroups(), TODAY, NOW, noFilter, pastAnchor)
    expect(dayKeys(past.sections)).toContain('2026-06-05')
    const pastTarget = past.sections[past.goToIndex]
    expect(pastTarget?.kind === 'day' && pastTarget.items).toEqual([])
  })

  it('does not force-render an empty today section when anchored elsewhere', () => {
    const anchor = new Date(2026, 5, 20)
    const onlyFuture = [occ('future-event', '2026-06-20', { time: '09:00' })]
    const { sections } = compute(null, onlyFuture, noGroups, TODAY, NOW, noFilter, anchor)

    expect(dayKeys(sections)).toEqual(['2026-06-20'])
  })

  it('re-targets when only the anchor changes', () => {
    const all = baseOccs()
    const first = compute(null, all, noGroups)
    const second = compute(first, all, noGroups, TODAY, NOW, noFilter, new Date(2026, 5, 20))

    expect(second).not.toBe(first)
    expect(second.rows[second.goToRowIndex]?.dateKey).toBe('2026-06-20')
  })

  it('still splices in the overdue rows when the anchor is far enough away that today falls outside the run', () => {
    const all = baseOccs()
    const farAnchor = addDays(TODAY, 500) // well past [anchor-365, anchor+90]'s reach back to today
    const { rows, goToRowIndex } = compute(null, all, baseGroups(), TODAY, NOW, noFilter, farAnchor)

    const headerIndex = rows.findIndex(r => r.kind === 'header')
    expect(headerIndex).toBeGreaterThanOrEqual(0)
    // Clamped to the run's first day, not dropped — and the scroll target is
    // still the anchor's own day, since an explicit jump outranks overdue.
    expect(rows[headerIndex]!.dateKey).toBe(fmtISO(TODAY))
    expect(rows[goToRowIndex]?.dateKey).toBe(fmtISO(farAnchor))
  })
})

describe('estimateRow', () => {
  const rowFor = (rows: AgendaRow[], id: string) =>
    rows.find(r => r.kind === 'occ' && r.occ.id === id)!

  it('estimates a plain day row shorter than one carrying a meta row', () => {
    const { rows } = compute(
      null,
      [
        occ('untimed', '2026-06-16'),
        occ('timed', '2026-06-16', { time: '11:00' }),
        occ('with-duration', '2026-06-16', { duration: '30m' }),
      ],
      noGroups,
    )

    // No badge at all — the card sits on its min-h-11 floor.
    expect(estimateRow(rowFor(rows, 'untimed'))).toBe(50)
    // A time badge or a duration chip each force the meta row.
    expect(estimateRow(rowFor(rows, 'timed'))).toBe(68)
    expect(estimateRow(rowFor(rows, 'with-duration'))).toBe(68)
  })

  it('estimates an overdue group row at the meta height — it always shows a date badge', () => {
    const untimed = occ('overdue-untimed', '2026-06-10', { done: false })
    const { rows } = compute(null, [untimed], [group(untimed)])

    expect(estimateRow(rows.find(r => r.kind === 'overdue-group')!)).toBe(68)
  })

  it('estimates the overdue header at its own height', () => {
    const { rows } = compute(null, baseOccs(), baseGroups())

    expect(estimateRow(rows.find(r => r.kind === 'header')!)).toBe(40)
  })

  it('estimates month/week dividers and empty-day rows at their own heights', () => {
    const { rows } = compute(null, [], noGroups)

    expect(estimateRow(rows.find(r => r.kind === 'month')!)).toBe(60)
    expect(estimateRow(rows.find(r => r.kind === 'week')!)).toBe(36)
    expect(estimateRow(rows.find(r => r.kind === 'day-empty')!)).toBe(56)
  })
})
