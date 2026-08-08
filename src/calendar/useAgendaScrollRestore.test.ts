// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { Occurrence } from '@/types'
import { computeAgendaSections, type FilterOccs, type AgendaRow } from './agendaSections'
import { calendarView, resetCalendarViewState } from './viewState'
import { useAgendaScrollRestore } from './useAgendaScrollRestore'

const TODAY = new Date(2026, 5, 15)
const NOW = new Date(2026, 5, 15, 9, 0)
const noFilter: FilterOccs = occs => occs

function occ(id: string, date: string, opts: { time?: string; done?: boolean } = {}): Occurrence {
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
      participants: [],
      ...(opts.done !== undefined ? { done: opts.done } : null),
      jsTime: new Date(y, m - 1, d, hh, mm),
    },
  }
}

/**
 * A past day-section (header + one timed event) followed by the overdue
 * section, whose header is the scroll-to-today target — so there are exactly
 * two rows above `goToRowIndex`.
 */
function agenda(): { rows: AgendaRow[]; goToRowIndex: number } {
  const { rows, goToRowIndex } = computeAgendaSections(
    null,
    [occ('past-event', '2026-06-10', { time: '10:00' }), occ('overdue-task', '2026-06-10', { done: false })],
    TODAY, NOW, noFilter,
  )
  return { rows, goToRowIndex }
}

beforeEach(() => {
  resetCalendarViewState()
})

describe('useAgendaScrollRestore', () => {
  it('seeds the offset at the scroll-to-today target using row estimates', () => {
    const { rows, goToRowIndex } = agenda()
    expect(goToRowIndex).toBe(2)

    const { result } = renderHook(() => useAgendaScrollRestore(true, rows, goToRowIndex))

    // The day header (40) plus one timed occurrence row (68) above the overdue
    // header. Starting anywhere else means the first painted frame shows the
    // wrong day and has to be corrected by a visible scroll.
    expect(result.current.initialOffset).toBe(108)
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
