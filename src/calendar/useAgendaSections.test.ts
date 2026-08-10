// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { setupStore, seedStore, makeOcc, makeRoots } from '@/test-utils'
import { fmtISO } from '@/model'
import { useAgendaSections } from './useAgendaSections'
import type { AgendaRow } from './useAgendaSections'
import { calendarView } from './viewState'

/** The overdue section starts collapsed (viewState.ts); expand it for tests about its contents. */
const expandOverdue = () => { calendarView.setState({ overdueCollapsed: false }) }

setupStore()

const TODAY = new Date(2026, 5, 15)
const NOW = new Date(2026, 5, 15, 9, 0)

/** Occurrence rows belonging to a given day, in order. */
const occIdsFor = (rows: AgendaRow[], dateKey: string) =>
  rows.filter(r => r.kind === 'occ' && r.dateKey === dateKey).map(r => r.kind === 'occ' && r.occ.id)

const headerTones = (rows: AgendaRow[]) =>
  rows.filter(r => r.kind === 'header').map(r => r.tone)

describe('useAgendaSections', () => {
  it('always seeds a today header, even with no occurrences', () => {
    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))

    expect(headerTones(result.current.rows)).toContain('today')
    expect(result.current.goToRowIndex).toBeGreaterThanOrEqual(0)
  })

  it('groups a same-day occurrence under today', () => {
    const occ = makeOcc({ id: 'today-1', date: '2026-06-15', time: '09:00' })
    seedStore([occ], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))

    expect(occIdsFor(result.current.rows, '2026-06-15')).toEqual(['today-1'])
  })

  it('splits an undone past task into overdue rows, ahead of its own day rows', () => {
    const overdueTask = makeOcc({
      id: 'overdue-1',
      date: '2026-06-10',
      time: null,
      metadata: { participants: [], title: 'Old task', tags: [], items: [], done: false },
    })
    const pastEvent = makeOcc({
      id: 'past-event-1',
      date: '2026-06-10',
      time: '10:00',
      fileSlug: 'other.md',
    })
    seedStore([overdueTask, pastEvent], new Map([...makeRoots('note.md'), ...makeRoots('other.md')]))
    expandOverdue()

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { rows, goToRowIndex } = result.current

    // The past day keeps its event; the undone task is hoisted into overdue,
    // whose rows carry todayKey rather than their own past day.
    expect(occIdsFor(rows, '2026-06-10')).toEqual(['past-event-1'])
    expect(occIdsFor(rows, '2026-06-15')).toEqual(['overdue-1'])
    expect(headerTones(rows)).toEqual(['default', 'overdue', 'today'])

    // goToRowIndex prefers the overdue header over today's when both exist.
    const target = rows[goToRowIndex]
    expect(target?.kind === 'header' && target.tone).toBe('overdue')
  })

  it('collapses the overdue section by default, keeping its header as the scroll target', () => {
    const overdueTask = makeOcc({
      id: 'overdue-1',
      date: '2026-06-10',
      time: null,
      metadata: { participants: [], title: 'Old task', tags: [], items: [], done: false },
    })
    seedStore([overdueTask], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { rows, goToRowIndex } = result.current

    // The divider is still there — and still where scroll-to-today lands — but
    // it's the whole section now, so the agenda opens on a one-line bar above
    // Today instead of the backlog itself.
    expect(headerTones(rows)).toEqual(['overdue', 'today'])
    expect(occIdsFor(rows, '2026-06-15')).toEqual([])
    const target = rows[goToRowIndex]
    expect(target?.kind === 'header' && target.tone).toBe('overdue')
    expect(target?.kind === 'header' && target.count).toBe(1)
  })

  it('points goToRowIndex at today when there is no overdue section', () => {
    const occ = makeOcc({ id: 'today-1', date: '2026-06-15', time: '09:00' })
    seedStore([occ], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { rows, goToRowIndex } = result.current

    expect(headerTones(rows)).not.toContain('overdue')
    const target = rows[goToRowIndex]
    expect(target?.kind === 'header' && target.tone).toBe('today')
  })

  it('hands back untouched rows by reference when a task is toggled done', () => {
    const roots = makeRoots('note.md')
    const task = makeOcc({
      id: 'today-task',
      date: '2026-06-15',
      time: '09:00',
      metadata: { participants: [], title: 'Task', tags: [], items: [], done: false },
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
