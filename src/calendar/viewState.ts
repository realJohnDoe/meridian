import { createStore } from 'zustand/vanilla'
import { useStore as useZustandStore } from 'zustand/react'
import type { VirtualItem } from '@tanstack/react-virtual'
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
   * True once the active view's scroll container has moved off its top edge —
   * drives the shared `#mainTop` header's scroll shadow (see _app.tsx). Set by
   * AgendaView and DayView's own scroll handling; other routes sharing the
   * header (month, list, entry) don't write it, so _app.tsx also gates display
   * on the current route rather than trusting this flag alone.
   */
  topbarShadow: boolean
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
  topbarShadow: false,
}))

export function resetCalendarViewState(): void {
  calendarView.setState(calendarView.getInitialState(), true)
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

export function useTopbarShadow(): boolean {
  return useZustandStore(calendarView, s => s.topbarShadow)
}

/** No-op if unchanged, so scroll handlers can call this on every scroll event
 * without forcing a re-render of every #mainTop subscriber each tick. */
export function setTopbarShadow(shadow: boolean): void {
  if (calendarView.getState().topbarShadow === shadow) return
  calendarView.setState({ topbarShadow: shadow })
}

/** Flags AgendaView to scroll to today on its next render. */
export function requestScrollToToday(): void {
  calendarView.setState({ scrollToTodayOnce: true })
}

export function setAgendaTopDate(key: string): void {
  calendarView.setState({ agendaTopDate: key })
}

/** Clears the scroll-to-today flag and records the date scrolled to, in one
 * write — splitting this into two setState calls would notify subscribers
 * twice, flashing the stale top date before it settles. */
export function markScrolledToToday(topDate: string): void {
  calendarView.setState({ scrollToTodayOnce: false, agendaTopDate: topDate })
}
