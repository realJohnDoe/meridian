import { createStore } from 'zustand/vanilla'
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
}

/** Calendar-view-local ephemeral state — scroll position, carousel previews.
 * Not persisted; meaningless outside the calendar views, so it lives here
 * rather than in the app-global store (src/store.ts). */
export const calendarView = createStore<CalendarViewState>(() => ({
  agendaScrollOffset: 0,
  agendaScrollMeasurements: [],
}))

export function resetCalendarViewState(): void {
  calendarView.setState(calendarView.getInitialState(), true)
}
