import { describe, it, expect } from 'vitest'
import { calendarView, resetCalendarViewState } from './viewState'

describe('calendarView', () => {
  it('setState writes are visible via getState', () => {
    calendarView.setState({ agendaScrollOffset: 42, agendaScrollMeasurements: [{ index: 0, start: 0, end: 10, size: 10, key: 'a', lane: 0 }] })

    expect(calendarView.getState().agendaScrollOffset).toBe(42)
    expect(calendarView.getState().agendaScrollMeasurements).toHaveLength(1)
  })

  it('resetCalendarViewState restores the initial state', () => {
    calendarView.setState({ agendaScrollOffset: 99, agendaScrollMeasurements: [{ index: 0, start: 0, end: 10, size: 10, key: 'a', lane: 0 }] })

    resetCalendarViewState()

    expect(calendarView.getState()).toEqual(calendarView.getInitialState())
    expect(calendarView.getState().agendaScrollOffset).toBe(0)
    expect(calendarView.getState().agendaScrollMeasurements).toEqual([])
  })
})
