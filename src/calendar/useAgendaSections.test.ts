// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { setupStore, seedStore, makeOcc, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import { fmtISO } from '@/model'
import { addDays } from '@/format'
import { useAgendaSections } from './useAgendaSections'
import type { AgendaRow } from './useAgendaSections'
import { agendaChunkRun, chunkRange, CHUNK_DAYS, EXPAND_PAST_DAYS, EXPAND_FUTURE_DAYS } from './agendaChunks'
import { OVERDUE_LOOKBACK_DAYS } from './overduePool'
import { calendarView } from './viewState'

/** The overdue section starts expanded (viewState.ts); collapse it for the test about that. */
const collapseOverdue = () => { calendarView.setState({ overdueCollapsed: true }) }

setupStore()

const TODAY = new Date(2026, 5, 15)
const NOW = new Date(2026, 5, 15, 9, 0)

/** Occurrence rows belonging to a given day, in order. */
const occIdsFor = (rows: AgendaRow[], dateKey: string) =>
  rows.filter(r => r.kind === 'occ' && r.dateKey === dateKey).map(r => r.kind === 'occ' && r.occ.id)

/** The overdue block's grouped rows, as `id ×count`. */
const overdueGroups = (rows: AgendaRow[]) =>
  rows.filter(r => r.kind === 'overdue-group').map(r => `${r.occ.id} ×${r.count}`)

/** Content rows only — strips the always-present month/week dividers so tests
 * can assert on the day/overdue structure without hardcoding the ~65 week and
 * ~15 month rows the [today-365, today+90] window always carries. */
const content = (rows: AgendaRow[]) => rows.filter(r => r.kind !== 'month' && r.kind !== 'week')

describe('the agenda\'s window constants', () => {
  // One number used to mean three different things: the expansion window, the
  // day-by-day render walk's span, and the overdue lookback. The walk's own
  // pair is gone — the walk covers exactly the chunks that were expanded (see
  // agendaChunks.ts), so "a day the walk visits but the expansion never
  // reached renders empty, silently" can no longer be expressed. What is left
  // is the run's chunk alignment, which that guarantee now rests on.
  it('covers the requested window with whole chunks, reaching at least as far in each direction', () => {
    const run = agendaChunkRun(TODAY, 1)
    const from = chunkRange(run[0]!, 1).from
    const to = chunkRange(run[run.length - 1]!, 1).to

    expect(run).toHaveLength(new Set(run).size)
    expect(run[run.length - 1]! - run[0]! + 1).toBe(run.length) // contiguous
    expect(from.getTime()).toBeLessThanOrEqual(addDays(TODAY, -EXPAND_PAST_DAYS).getTime())
    expect(to.getTime()).toBeGreaterThanOrEqual(addDays(TODAY, EXPAND_FUTURE_DAYS).getTime())
    // Every chunk boundary is a week start, which is what makes a chunk's
    // month/week dividers a pure function of its own index.
    for (const index of run) expect(chunkRange(index, 1).from.getDay()).toBe(1)
    expect(CHUNK_DAYS % 7).toBe(0)
  })

  it('looks back for overdue work independently of the agenda window', () => {
    // No relationship required in either direction — the overdue pass runs its
    // own expansion (overduePool.ts), which is the point of the split.
    expect(OVERDUE_LOOKBACK_DAYS).toBeGreaterThan(0)
  })
})

describe('useAgendaSections', () => {
  it('always seeds a badged, empty today row, even with no occurrences', () => {
    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))

    const todayRow = result.current.rows.find(r => r.kind === 'day-empty')
    expect(todayRow?.kind === 'day-empty' && todayRow.isToday).toBe(true)
    expect(result.current.goToRowIndex).toBeGreaterThanOrEqual(0)
  })

  it('groups a same-day occurrence under today', () => {
    const occ = makeOcc({ id: 'today-1', date: '2026-06-15', time: '09:00' })
    seedStore([occ], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))

    expect(occIdsFor(result.current.rows, '2026-06-15')).toEqual(['today-1'])
  })

  it('summarises an undone past task in overdue while leaving it on its own day', () => {
    const overdueTask = makeOcc({
      id: 'overdue-1',
      date: '2026-06-10',
      time: null,
      metadata: { vaultId: TEST_VAULT, fileSlug: 'other.md', participants: [], title: 'Old task', tags: [], items: [], done: false },
    })
    const pastEvent = makeOcc({
      id: 'past-event-1',
      date: '2026-06-10',
      time: '10:00',
      entryKey: testKey('other.md'),
    })
    seedStore([overdueTask, pastEvent], new Map([...makeRoots('note.md'), ...makeRoots('other.md')]))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { rows, goToRowIndex } = result.current

    // The past day keeps *both* occurrences — undone tasks are no longer hoisted
    // out of their day — and the overdue block summarises the task above today.
    expect(occIdsFor(rows, '2026-06-10')).toEqual(['overdue-1', 'past-event-1'])
    expect(overdueGroups(rows)).toEqual(['overdue-1 ×1'])
    // the past day's two rows → overdue header → its group row → today's forced-empty row.
    expect(content(rows).map(r => r.kind)).toEqual(['occ', 'occ', 'header', 'overdue-group', 'day-empty'])

    // goToRowIndex prefers the overdue header over today's when both exist.
    expect(rows[goToRowIndex]?.kind).toBe('header')
  })

  // Scroll-to-today targets the overdue header when there is one, so this is
  // what the agenda actually opens on: the overdue work itself, with Today
  // directly below it.
  it('expands the overdue section by default, keeping its header as the scroll target', () => {
    const overdueTask = makeOcc({
      id: 'overdue-1',
      date: '2026-06-10',
      time: null,
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Old task', tags: [], items: [], done: false },
    })
    seedStore([overdueTask], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { rows, goToRowIndex } = result.current

    // the task on its own past day → overdue header → its group row → today.
    expect(content(rows).map(r => r.kind)).toEqual(['occ', 'header', 'overdue-group', 'day-empty'])
    // Overdue rows carry todayKey, not their own past day — see agendaSections.
    expect(rows.find(r => r.kind === 'overdue-group')?.dateKey).toBe('2026-06-15')
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('header')
    expect(target?.kind === 'header' && target.count).toBe(1)
  })

  it('collapses the overdue section to just its header when the user collapses it', () => {
    const overdueTask = makeOcc({
      id: 'overdue-1',
      date: '2026-06-10',
      time: null,
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Old task', tags: [], items: [], done: false },
    })
    seedStore([overdueTask], makeRoots('note.md'))
    collapseOverdue()

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { rows, goToRowIndex } = result.current

    // The divider stays — and stays where scroll-to-today lands — but it is the
    // whole section now, so the agenda shows a one-line bar above today.
    expect(content(rows).map(r => r.kind)).toEqual(['occ', 'header', 'day-empty'])
    expect(overdueGroups(rows)).toEqual([])
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('header')
    expect(target?.kind === 'header' && target.count).toBe(1)
  })

  it('points goToRowIndex at today\'s own badged row when there is no overdue section', () => {
    const occ = makeOcc({ id: 'today-1', date: '2026-06-15', time: '09:00' })
    seedStore([occ], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { rows, goToRowIndex } = result.current

    expect(rows.some(r => r.kind === 'header')).toBe(false)
    const target = rows[goToRowIndex]
    expect(target?.kind).toBe('occ')
    expect(target?.kind === 'occ' && target.badge?.isToday).toBe(true)
  })

  it('hands back untouched rows by reference when a task is toggled done', () => {
    const roots = makeRoots('note.md')
    const task = makeOcc({
      id: 'today-task',
      date: '2026-06-15',
      time: '09:00',
      metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Task', tags: [], items: [], done: false },
    })
    const future = makeOcc({ id: 'future-1', date: '2026-06-20', time: '09:00' })
    seedStore([task, future], roots)

    const { result, rerender } = renderHook(() => useAgendaSections(TODAY, NOW))
    const futureRowBefore = result.current.rows.find(r => r.kind === 'occ' && r.occ.id === 'future-1')
    expect(futureRowBefore).toBeDefined()

    act(() => {
      seedStore([{ ...task, metadata: { ...task.metadata, done: true } }, future], roots)
    })
    rerender()

    // The toggled row carries the new value…
    const toggled = result.current.rows.find(r => r.kind === 'occ' && r.occ.id === 'today-task')
    expect(toggled?.kind === 'occ' && toggled.occ.metadata.done).toBe(true)
    // …while every untouched row is the very same object, so AgendaRow's
    // memo skips it instead of re-rendering the rest of the vault.
    expect(result.current.rows.find(r => r.kind === 'occ' && r.occ.id === 'future-1')).toBe(futureRowBefore)
  })

  describe('anchor', () => {
    // Well beyond today's own ±90-day future window, so it only shows up once
    // the window itself re-centers on an anchor near it.
    const farFuture = new Date(2026, 5, 15 + 120)

    it('excludes a day outside the default window when anchor stays at today', () => {
      seedStore([makeOcc({ id: 'far-future', date: fmtISO(farFuture), time: '09:00' })], makeRoots('note.md'))

      const { result } = renderHook(() => useAgendaSections(TODAY, NOW))

      expect(occIdsFor(result.current.rows, fmtISO(farFuture))).toEqual([])
    })

    it('re-centers the expansion window when a different anchor is passed', () => {
      seedStore([makeOcc({ id: 'far-future', date: fmtISO(farFuture), time: '09:00' })], makeRoots('note.md'))

      const { result } = renderHook(() => useAgendaSections(TODAY, NOW, farFuture))

      expect(occIdsFor(result.current.rows, fmtISO(farFuture))).toEqual(['far-future'])
      // The anchor day itself is the scroll target, not today's (now out-of-window) section.
      const target = result.current.rows[result.current.goToRowIndex]
      expect(target?.dateKey).toBe(fmtISO(farFuture))
    })
  })
})
