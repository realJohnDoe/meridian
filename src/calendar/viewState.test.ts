// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { setupStore } from '@/test-utils'
import { startOfToday } from 'date-fns'
import { fmtISO } from '@/model'
import {
  calendarView, resetCalendarViewState,
  useMonthPreview, useDayPreview, useWeekPreview, setMonthPreview, setDayPreview, setWeekPreview,
  useAgendaAnchor, useAgendaScrollTarget, useAgendaTopDate,
  requestScrollToToday, requestScrollToDate, setAgendaTopDate, markAgendaScrolled,
  weekdayKeptDate,
  monthDayKeptDate,
  useQuickNavBrowsePreview, setQuickNavBrowsePreview, toggleQuickNav, closeQuickNav,
} from './viewState'

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
      weekPreview: '2026-07-20',
      agendaAnchor: '2026-07-26',
      agendaScrollTarget: '2026-07-26',
      agendaTopDate: '2026-07-26',
      quickNavBrowsePreview: '2026-07-01',
    })

    resetCalendarViewState()

    expect(calendarView.getState()).toEqual(calendarView.getInitialState())
    expect(calendarView.getState().agendaScrollOffset).toBe(0)
    expect(calendarView.getState().agendaScrollMeasurements).toEqual([])
    expect(calendarView.getState().monthPreview).toBeNull()
    expect(calendarView.getState().dayPreview).toBeNull()
    expect(calendarView.getState().weekPreview).toBeNull()
    expect(calendarView.getState().quickNavBrowsePreview).toBeNull()
    // Not null: the agenda's resting default is "scroll to today" — see the
    // agendaScrollTarget doc in viewState.ts.
    expect(calendarView.getState().agendaScrollTarget).toBe(fmtISO(startOfToday()))
    expect(calendarView.getState().agendaTopDate).toBeNull()
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

  it('starts null and reflects setWeekPreview writes reactively', () => {
    const { result } = renderHook(() => useWeekPreview())
    expect(result.current).toBeNull()

    act(() => setWeekPreview('2026-08-10'))
    expect(result.current).toBe('2026-08-10')

    act(() => setWeekPreview(null))
    expect(result.current).toBeNull()
  })

  it('setMonthPreview does not affect dayPreview/weekPreview and vice versa', () => {
    act(() => {
      setMonthPreview('2026-08')
      setDayPreview('2026-08-01')
      setWeekPreview('2026-08-10')
    })

    expect(calendarView.getState().monthPreview).toBe('2026-08')
    expect(calendarView.getState().dayPreview).toBe('2026-08-01')
    expect(calendarView.getState().weekPreview).toBe('2026-08-10')
  })
})

describe('useQuickNavBrowsePreview / closeQuickNav', () => {
  it('starts null and reflects setQuickNavBrowsePreview writes reactively', () => {
    const { result } = renderHook(() => useQuickNavBrowsePreview())
    expect(result.current).toBeNull()

    act(() => setQuickNavBrowsePreview('2026-08-01'))
    expect(result.current).toBe('2026-08-01')

    act(() => setQuickNavBrowsePreview(null))
    expect(result.current).toBeNull()
  })

  // The day/week route files fall back from this to their own route param
  // the moment it's null (see _app.day.$date.tsx/_app.week.$date.tsx) — so
  // a preview left set past its relevance would mis-render whichever route
  // reads it next. closeQuickNav is the one call already made on every view
  // change (see its own doc comment), which is what makes it the safe place
  // to guarantee that never happens, independent of MiniMonth's own
  // mount/unmount lifecycle.
  it('closeQuickNav clears a pending browse preview, not just quickNavOpen', () => {
    act(() => {
      toggleQuickNav()
      setQuickNavBrowsePreview('2026-08-01')
    })
    expect(calendarView.getState().quickNavOpen).toBe(true)
    expect(calendarView.getState().quickNavBrowsePreview).toBe('2026-08-01')

    act(() => closeQuickNav())

    expect(calendarView.getState().quickNavOpen).toBe(false)
    expect(calendarView.getState().quickNavBrowsePreview).toBeNull()
  })
})

describe('weekdayKeptDate', () => {
  it('preserves the weekday offset when paging to a later week', () => {
    // 2026-08-12 is a Wednesday; Monday-start week runs Aug 10-16.
    expect(weekdayKeptDate('2026-08-17', '2026-08-12', 1)).toBe('2026-08-19') // next Wednesday
  })

  it('normalizes an arbitrary date within the target week to the same result as its week start', () => {
    expect(weekdayKeptDate('2026-08-20', '2026-08-12', 1)).toBe('2026-08-19')
  })

  it('respects a Sunday-start week convention', () => {
    // Sunday-start week containing Aug 12 (Wed) runs Aug 9-15; offset is 3 days.
    expect(weekdayKeptDate('2026-08-16', '2026-08-12', 0)).toBe('2026-08-19')
  })

  it('carries the offset correctly across a year boundary', () => {
    // 2025-12-31 is a Wednesday; Monday-start week runs Dec 29 - Jan 4, offset 2 days.
    expect(weekdayKeptDate('2026-01-05', '2025-12-31', 1)).toBe('2026-01-07')
  })
})

describe('monthDayKeptDate', () => {
  it('keeps the day-of-month, clamped to the target month', () => {
    expect(monthDayKeptDate('2026-10-01', '2026-09-08')).toBe('2026-10-08')
    expect(monthDayKeptDate('2026-02-01', '2026-01-31')).toBe('2026-02-28')
  })
})

describe('useAgendaAnchor / useAgendaScrollTarget / useAgendaTopDate', () => {
  it('requestScrollToToday sets both the anchor and the pending target to today', () => {
    const { result: anchorResult } = renderHook(() => useAgendaAnchor())
    const { result: targetResult } = renderHook(() => useAgendaScrollTarget())
    const today = anchorResult.current // whatever "today" resolved to at init

    act(() => requestScrollToToday())

    expect(anchorResult.current).toBe(today)
    expect(targetResult.current).toBe(today)
  })

  it('requestScrollToDate re-centers the anchor on an arbitrary day', () => {
    const { result: anchorResult } = renderHook(() => useAgendaAnchor())
    const { result: targetResult } = renderHook(() => useAgendaScrollTarget())

    act(() => requestScrollToDate('2026-12-25'))

    expect(anchorResult.current).toBe('2026-12-25')
    expect(targetResult.current).toBe('2026-12-25')
  })

  it('setAgendaTopDate updates reactively', () => {
    const { result } = renderHook(() => useAgendaTopDate())
    expect(result.current).toBeNull()

    act(() => setAgendaTopDate('2026-07-26'))
    expect(result.current).toBe('2026-07-26')
  })

  it('markAgendaScrolled clears the pending target and sets the date in one write, leaving the anchor alone', () => {
    act(() => requestScrollToDate('2026-07-26'))

    const { result: targetResult } = renderHook(() => useAgendaScrollTarget())
    const { result: anchorResult } = renderHook(() => useAgendaAnchor())
    const { result: dateResult } = renderHook(() => useAgendaTopDate())

    act(() => markAgendaScrolled('2026-07-26'))

    expect(targetResult.current).toBeNull()
    expect(anchorResult.current).toBe('2026-07-26')
    expect(dateResult.current).toBe('2026-07-26')
  })
})
