import { createStore } from 'zustand/vanilla'
import { useStore as useZustandStore } from 'zustand/react'
import { startOfToday } from 'date-fns'
import type { VirtualItem } from '@tanstack/react-virtual'
import { fmtISO } from '@/model'
import { resetExpansionCache } from './useExpandWithMultiday'
import { resetAgendaSectionsCache } from './useAgendaSections'

interface CalendarViewState {
  /**
   * Scroll position snapshot so AgendaView restores it across remounts (e.g.
   * navigating to month/day and back) instead of resetting to the top. Written
   * on unmount, read to seed the virtualizer's initial* options on the next
   * mount — see useAgendaScrollRestore/useSaveAgendaScroll and
   * resetCalendarOnVaultChange (cleared on vault change, since a snapshot from a
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
  /** When true, AgendaView will scroll to today once then clear this flag. */
  scrollToTodayOnce: boolean
  /** ISO date string of the topmost visible day in the agenda view. */
  agendaTopDate: string | null
  /**
   * ISO date (`YYYY-MM-DD`) of the day last focused across the calendar
   * views — kept in sync with agenda's scroll position, the day carousel's
   * route param, and month's day-of-month (see setCurrentMonthKeepingDay).
   * Read by the sidebar so switching between Agenda/Month/Day lands on this
   * day instead of resetting to today.
   */
  currentDate: string
}

/** Calendar-view-local ephemeral state — scroll position, carousel previews.
 * Not persisted; meaningless outside the calendar views, so it lives here
 * rather than in the app-global store (src/store.ts). */
export const calendarView = createStore<CalendarViewState>(() => ({
  agendaScrollOffset: 0,
  agendaScrollMeasurements: [],
  monthPreview: null,
  dayPreview: null,
  scrollToTodayOnce: false,
  agendaTopDate: null,
  currentDate: fmtISO(startOfToday()),
}))

export function resetCalendarViewState(): void {
  // currentDate is recomputed rather than taken from the frozen initial
  // snapshot — getInitialState() captured "today" at module load, which can
  // be stale by the time a long-lived tab switches vaults.
  calendarView.setState({ ...calendarView.getInitialState(), currentDate: fmtISO(startOfToday()) }, true)
}

/**
 * Drops every piece of calendar-view state that belongs to the vault that
 * just deactivated — cached occurrence expansions, cached agenda sections,
 * and the view-local scroll/preview state. Call once on vault change; nothing
 * else needs to hand-enumerate these.
 *
 * Deliberately does not also call requestScrollToToday() — the caller does
 * that itself, after this returns. Folding it in here would mean this reset
 * (a full-state replace, see resetCalendarViewState above) always stomps the
 * flag right back to false, and it would leave test cleanup (which wants a
 * clean *initial* state, not a pending scroll) with scrollToTodayOnce stuck
 * true for the next test.
 */
export function resetCalendarOnVaultChange(): void {
  resetExpansionCache()
  resetAgendaSectionsCache()
  resetCalendarViewState()
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

export function useScrollToTodayOnce(): boolean {
  return useZustandStore(calendarView, s => s.scrollToTodayOnce)
}

export function useAgendaTopDate(): string | null {
  return useZustandStore(calendarView, s => s.agendaTopDate)
}

export function useCurrentDate(): string {
  return useZustandStore(calendarView, s => s.currentDate)
}

/** Flags AgendaView to scroll to today on its next render. */
export function requestScrollToToday(): void {
  calendarView.setState({ scrollToTodayOnce: true })
}

export function setAgendaTopDate(key: string): void {
  calendarView.setState({ agendaTopDate: key, currentDate: key })
}

/** Records the day currently focused — e.g. the day view's route param on
 * mount/swipe, or month's day-of-month via setCurrentMonthKeepingDay. */
export function setCurrentDate(dateKey: string): void {
  calendarView.setState({ currentDate: dateKey })
}

/**
 * Updates currentDate when the month carousel pages to a new month, keeping
 * the same day-of-month (clamped to the target month's last day) instead of
 * jumping to the 1st — e.g. paging from Sep 8 to October lands on Oct 8; Jan
 * 31 to February lands on Feb 28.
 */
export function setCurrentMonthKeepingDay(monthKey: string): void {
  const day = Number(calendarView.getState().currentDate.slice(8, 10))
  const [y = NaN, m = NaN] = monthKey.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const clampedDay = Math.min(day, daysInMonth)
  calendarView.setState({ currentDate: `${monthKey}-${String(clampedDay).padStart(2, '0')}` })
}

/** Clears the scroll-to-today flag and records the date scrolled to, in one
 * write — splitting this into two setState calls would notify subscribers
 * twice, flashing the stale top date before it settles. */
export function markScrolledToToday(topDate: string): void {
  calendarView.setState({ scrollToTodayOnce: false, agendaTopDate: topDate, currentDate: topDate })
}
