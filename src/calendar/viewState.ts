import { createStore } from 'zustand/vanilla'
import { useStore as useZustandStore } from 'zustand/react'
import { startOfToday, addDays, differenceInCalendarDays } from 'date-fns'
import type { VirtualItem } from '@tanstack/react-virtual'
import { fmtISO } from '@/model'
import { resetExpansionCache } from './useExpandWithMultiday'
import { resetAgendaSectionsCache } from './useAgendaSections'
import { weekStartFor } from './weekRange'

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
  /** `YYYY-MM-DD` of the week-start the week-view swipe carousel is settling toward — same shape as monthPreview/dayPreview. */
  weekPreview: string | null
  /**
   * ISO date (`YYYY-MM-DD`) AgendaView's expansion window is centered on —
   * `[agendaAnchor - 365d, agendaAnchor + 90d]`, see useAgendaSections.
   * Defaults to today and only moves on an explicit jump (requestScrollToDate),
   * so an ordinary scroll or remount never shifts it — the window has to stay
   * stable while mounted, or rows would shuffle out from under the scroll
   * position. Read by AgendaView on every render, unlike agendaScrollTarget
   * below, which is consumed once.
   */
  agendaAnchor: string
  /**
   * ISO date (`YYYY-MM-DD`) AgendaView should scroll to on its next render,
   * then clear back to null. Always set together with agendaAnchor (see
   * requestScrollToDate) so the target's row exists in the freshly-centered
   * window by the time the scroll fires.
   */
  agendaScrollTarget: string | null
  /** ISO date string of the topmost visible day in the agenda view. */
  agendaTopDate: string | null
  /**
   * Whether the agenda's overdue section is collapsed to just its header row.
   *
   * Starts collapsed, which is what keeps scroll-to-today's overdue preference
   * (see agendaSections.ts's `preferOverdue`) from landing the user on an
   * unbounded wall of unfinished work: the target is still the overdue section,
   * but collapsed it's a single bar sitting directly above Today. Expanding is
   * a per-session act — this is view-ephemeral like the rest of this store, so
   * a reload starts collapsed again.
   */
  overdueCollapsed: boolean
  /**
   * ISO date (`YYYY-MM-DD`) of the day last focused across the calendar
   * views — kept in sync with agenda's scroll position, the day carousel's
   * route param, and month's day-of-month (see setCurrentMonthKeepingDay).
   * Read by the sidebar so switching between Agenda/Month/Week/Day lands on
   * this day instead of resetting to today.
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
  weekPreview: null,
  agendaAnchor: fmtISO(startOfToday()),
  agendaScrollTarget: null,
  agendaTopDate: null,
  overdueCollapsed: true,
  currentDate: fmtISO(startOfToday()),
}))

export function resetCalendarViewState(): void {
  // currentDate/agendaAnchor are recomputed rather than taken from the frozen
  // initial snapshot — getInitialState() captured "today" at module load,
  // which can be stale by the time a long-lived tab switches vaults.
  const today = fmtISO(startOfToday())
  calendarView.setState({ ...calendarView.getInitialState(), currentDate: today, agendaAnchor: today }, true)
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
 * pending target right back to null, and it would leave test cleanup (which
 * wants a clean *initial* state, not a pending scroll) with agendaScrollTarget
 * stuck non-null for the next test.
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

export function useWeekPreview(): string | null {
  return useZustandStore(calendarView, s => s.weekPreview)
}

export function setMonthPreview(key: string | null): void {
  calendarView.setState({ monthPreview: key })
}

export function setDayPreview(key: string | null): void {
  calendarView.setState({ dayPreview: key })
}

export function setWeekPreview(key: string | null): void {
  calendarView.setState({ weekPreview: key })
}

export function useAgendaAnchor(): string {
  return useZustandStore(calendarView, s => s.agendaAnchor)
}

export function useAgendaScrollTarget(): string | null {
  return useZustandStore(calendarView, s => s.agendaScrollTarget)
}

export function useAgendaTopDate(): string | null {
  return useZustandStore(calendarView, s => s.agendaTopDate)
}

export function useCurrentDate(): string {
  return useZustandStore(calendarView, s => s.currentDate)
}

export function useOverdueCollapsed(): boolean {
  return useZustandStore(calendarView, s => s.overdueCollapsed)
}

export function toggleOverdueCollapsed(): void {
  calendarView.setState(s => ({ overdueCollapsed: !s.overdueCollapsed }))
}

/**
 * Flags AgendaView to re-center its window on `dateKey` and scroll there on
 * its next render, then clear the pending target — used for jumps to a day
 * that may fall outside the default window (e.g. arriving from a Month/Day
 * view that had paged far from today; see Sidebar's Agenda nav item).
 */
export function requestScrollToDate(dateKey: string): void {
  calendarView.setState({ agendaAnchor: dateKey, agendaScrollTarget: dateKey })
}

/** Flags AgendaView to scroll to today on its next render. */
export function requestScrollToToday(): void {
  requestScrollToDate(fmtISO(startOfToday()))
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

/**
 * Updates currentDate when the week carousel pages to a new week, keeping
 * the same weekday instead of jumping to the week's first day — e.g. paging
 * from Wed Aug 12 to the next week lands on Wed Aug 19. Mirrors
 * setCurrentMonthKeepingDay's day-of-month preservation.
 *
 * `dateKey` is any date within the target week, not necessarily its start —
 * the route param itself isn't guaranteed to be week-start-normalized on
 * first mount (see WeekView), so normalization happens here via `ws` rather
 * than being required of the caller.
 */
export function setCurrentWeekKeepingWeekday(dateKey: string, ws: 0 | 1 | 6): void {
  const [ny = NaN, nm = NaN, nd = NaN] = dateKey.split('-').map(Number)
  const newWeekStart = weekStartFor(new Date(ny, nm - 1, nd), ws)

  const current = calendarView.getState().currentDate
  const [cy = NaN, cm = NaN, cd = NaN] = current.split('-').map(Number)
  const currentDateObj = new Date(cy, cm - 1, cd)
  const offsetDays = differenceInCalendarDays(currentDateObj, weekStartFor(currentDateObj, ws))

  calendarView.setState({ currentDate: fmtISO(addDays(newWeekStart, offsetDays)) })
}

/** Clears the pending scroll target and records the date scrolled to, in one
 * write — splitting this into two setState calls would notify subscribers
 * twice, flashing the stale top date before it settles. Does not touch
 * agendaAnchor: it was already set to this date by whatever requested the
 * scroll (requestScrollToDate/requestScrollToToday). */
export function markAgendaScrolled(topDate: string): void {
  calendarView.setState({ agendaScrollTarget: null, agendaTopDate: topDate, currentDate: topDate })
}
