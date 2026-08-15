// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Occurrence } from '@/types'
import type { AgendaRow } from './agendaSections'
import { calendarView, resetCalendarViewState } from './viewState'
import { useAgendaScrollRestore } from './useAgendaScrollRestore'
import { testKey, TEST_VAULT } from '@/test-utils'

function occ(id: string, date: string, opts: { time?: string; done?: boolean } = {}): Occurrence {
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
      participants: [],
      ...(opts.done !== undefined ? { done: opts.done } : null),
      jsTime: new Date(y, m - 1, d, hh, mm),
    },
  }
}

/**
 * A hand-built row list rather than a real computeAgendaSections() result:
 * the real [today-365, today+90] window always carries dozens of week/month
 * divider rows before any actual content, which would make the offset math
 * below a function of exact calendar arithmetic instead of the row-summing
 * logic this hook actually owns. A week divider, a badged past-day
 * occurrence, then the overdue header (the scroll-to-today target) — so
 * there are exactly two rows above `goToRowIndex`, mirroring the shape a
 * real agenda produces just ahead of Overdue.
 */
function agenda(): { rows: AgendaRow[]; goToRowIndex: number } {
  const rows: AgendaRow[] = [
    { kind: 'week', key: 'w|2026-06-08', dateKey: '2026-06-10', label: 'Week 24, Jun 8 – 14' },
    {
      kind: 'occ', key: 'past-event|1', dateKey: '2026-06-10',
      occ: occ('past-event', '2026-06-10', { time: '10:00' }),
      showDate: false, isToday: false, badge: { date: new Date(2026, 5, 10), isToday: false },
    },
    { kind: 'header', key: 'h|__overdue__', dateKey: '2026-06-15', label: 'Overdue', collapsible: true, collapsed: false, count: 1 },
    {
      kind: 'occ', key: 'overdue-task|1', dateKey: '2026-06-15',
      occ: occ('overdue-task', '2026-06-10', { done: false }),
      showDate: true, isToday: false, badge: null,
    },
  ]
  return { rows, goToRowIndex: 2 }
}

beforeEach(() => {
  resetCalendarViewState()
})

describe('useAgendaScrollRestore', () => {
  it('seeds the offset at the scroll-to-today target using row estimates', () => {
    const { rows, goToRowIndex } = agenda()
    expect(goToRowIndex).toBe(2)

    const { result } = renderHook(() => useAgendaScrollRestore(true, rows, goToRowIndex))

    // The week divider (36) plus one timed occurrence row (68) above the
    // overdue header. Starting anywhere else means the first painted frame
    // shows the wrong day and has to be corrected by a visible scroll.
    expect(result.current.initialOffset).toBe(104)
  })

  it('prefers real measured sizes from the snapshot, matched by row key', () => {
    const { rows, goToRowIndex } = agenda()
    calendarView.setState({
      agendaScrollMeasurements: [
        { index: 0, start: 0, end: 30, size: 30, key: rows[0]!.key, lane: 0 },
        { index: 1, start: 30, end: 85, size: 55, key: rows[1]!.key, lane: 0 },
      ],
    })

    const { result } = renderHook(() => useAgendaScrollRestore(true, rows, goToRowIndex))

    expect(result.current.initialOffset).toBe(85)
  })

  it('falls back to the estimate for rows the snapshot has no size for', () => {
    const { rows, goToRowIndex } = agenda()
    calendarView.setState({
      agendaScrollMeasurements: [
        { index: 0, start: 0, end: 30, size: 30, key: rows[0]!.key, lane: 0 },
      ],
    })

    const { result } = renderHook(() => useAgendaScrollRestore(true, rows, goToRowIndex))

    expect(result.current.initialOffset).toBe(30 + 68)
  })

  // The cold-start regression this whole seeding mechanism exists for: on a
  // fresh load nothing has requested a scroll, and `agendaScrollOffset` is 0 —
  // the top of the ~455-day window, ten screens above today. viewState's
  // agendaScrollTarget therefore defaults to today rather than null, so the
  // very first mount takes the seeded branch with no signal from anywhere.
  it('has a scroll-to-today pending by default, so a cold start seeds at today', () => {
    const { rows, goToRowIndex } = agenda()
    const pending = calendarView.getState().agendaScrollTarget !== null

    expect(pending).toBe(true)

    const { result } = renderHook(() => useAgendaScrollRestore(pending, rows, goToRowIndex))
    expect(result.current.initialOffset).toBe(104)
    expect(result.current.initialOffset).not.toBe(calendarView.getState().agendaScrollOffset)
  })

  it('restores the saved scroll offset when no scroll-to-today is pending', () => {
    const { rows, goToRowIndex } = agenda()
    calendarView.setState({ agendaScrollOffset: 1234 })

    const { result } = renderHook(() => useAgendaScrollRestore(false, rows, goToRowIndex))

    expect(result.current.initialOffset).toBe(1234)
  })

  it('starts at the top when the target is the first row or missing', () => {
    const { rows } = agenda()

    expect(renderHook(() => useAgendaScrollRestore(true, rows, 0)).result.current.initialOffset).toBe(0)
    expect(renderHook(() => useAgendaScrollRestore(true, rows, -1)).result.current.initialOffset).toBe(0)
  })

  it('always passes the measurement snapshot through, seeded or restored', () => {
    const { rows, goToRowIndex } = agenda()
    const snapshot = [{ index: 0, start: 0, end: 30, size: 30, key: rows[0]!.key, lane: 0 }]
    calendarView.setState({ agendaScrollMeasurements: snapshot })

    expect(renderHook(() => useAgendaScrollRestore(true, rows, goToRowIndex)).result.current.initialMeasurementsCache).toBe(snapshot)
    expect(renderHook(() => useAgendaScrollRestore(false, rows, goToRowIndex)).result.current.initialMeasurementsCache).toBe(snapshot)
  })
})
