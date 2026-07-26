import { createStore } from 'zustand/vanilla'
import { useStore as useZustandStore } from 'zustand/react'
import type { VirtualItem } from '@tanstack/react-virtual'

interface CalendarViewState {
  /**
   * Scroll position snapshot so AgendaView restores it across remounts (e.g.
   * navigating to month/day and back) instead of resetting to the top. Written
   * on unmount, read to seed the virtualizer's initial* options on the next
   * mount — see useAgendaScrollRestore/useSaveAgendaScroll and
   * resetAgendaScroll (cleared on vault change, since a snapshot from a
   * different vault's agenda is meaningless).
   */
  agendaScrollOffset: number
  agendaScrollMeasurements: VirtualItem[]
  /**
   * `YYYY-MM` of the month the swipe carousel is settling toward, set on
   * touchend so the topbar label updates immediately instead of waiting for
   * the gesture to fully settle and the route to commit. Null once the route
   * is authoritative again (see MonthView's month-change effect).
   */
  monthPreview: string | null
  /** `YYYY-MM-DD` of the date the day-view swipe carousel is settling toward — same shape as monthPreview. */
  dayPreview: string | null
}

/** Calendar-view-local ephemeral state — scroll position, carousel previews.
 * Not persisted; meaningless outside the calendar views, so it lives here
 * rather than in the app-global store (src/store.ts). */
export const calendarView = createStore<CalendarViewState>(() => ({
  agendaScrollOffset: 0,
  agendaScrollMeasurements: [],
  monthPreview: null,
  dayPreview: null,
}))

export function resetCalendarViewState(): void {
  calendarView.setState(calendarView.getInitialState(), true)
}

export function useMonthPreview(): string | null {
  return useZustandStore(calendarView, s => s.monthPreview)
}

export function useDayPreview(): string | null {
  return useZustandStore(calendarView, s => s.dayPreview)
}

export function setMonthPreview(key: string | null): void {
  calendarView.setState({ monthPreview: key })
}

export function setDayPreview(key: string | null): void {
  calendarView.setState({ dayPreview: key })
}
