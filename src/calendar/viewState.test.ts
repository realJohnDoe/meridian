// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { setupStore } from '@/test-utils'
import { calendarView, resetCalendarViewState, useMonthPreview, useDayPreview, setMonthPreview, setDayPreview } from './viewState'

setupStore()

describe('calendarView', () => {
  it('setState writes are visible via getState', () => {
    calendarView.setState({ agendaScrollOffset: 42, agendaScrollMeasurements: [{ index: 0, start: 0, end: 10, size: 10, key: 'a', lane: 0 }] })

    expect(calendarView.getState().agendaScrollOffset).toBe(42)
    expect(calendarView.getState().agendaScrollMeasurements).toHaveLength(1)
  })

  it('resetCalendarViewState restores the initial state', () => {
    calendarView.setState({
      agendaScrollOffset: 99,
      agendaScrollMeasurements: [{ index: 0, start: 0, end: 10, size: 10, key: 'a', lane: 0 }],
      monthPreview: '2026-07',
      dayPreview: '2026-07-26',
    })

    resetCalendarViewState()

    expect(calendarView.getState()).toEqual(calendarView.getInitialState())
    expect(calendarView.getState().agendaScrollOffset).toBe(0)
    expect(calendarView.getState().agendaScrollMeasurements).toEqual([])
    expect(calendarView.getState().monthPreview).toBeNull()
    expect(calendarView.getState().dayPreview).toBeNull()
  })
})

describe('useMonthPreview / useDayPreview', () => {
  it('starts null and reflects setMonthPreview writes reactively', () => {
    const { result } = renderHook(() => useMonthPreview())
    expect(result.current).toBeNull()

    act(() => setMonthPreview('2026-08'))
    expect(result.current).toBe('2026-08')

    act(() => setMonthPreview(null))
    expect(result.current).toBeNull()
  })

  it('starts null and reflects setDayPreview writes reactively', () => {
    const { result } = renderHook(() => useDayPreview())
    expect(result.current).toBeNull()

    act(() => setDayPreview('2026-08-01'))
    expect(result.current).toBe('2026-08-01')

    act(() => setDayPreview(null))
    expect(result.current).toBeNull()
  })

  it('setMonthPreview does not affect dayPreview and vice versa', () => {
    act(() => {
      setMonthPreview('2026-08')
      setDayPreview('2026-08-01')
    })

    expect(calendarView.getState().monthPreview).toBe('2026-08')
    expect(calendarView.getState().dayPreview).toBe('2026-08-01')
  })
})
