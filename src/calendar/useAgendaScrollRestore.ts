import { useLayoutEffect } from 'react'
import type { Virtualizer, VirtualItem } from '@tanstack/react-virtual'
import { calendarView } from './viewState'

type AgendaVirtualizer = Virtualizer<HTMLDivElement, Element>

/**
 * Discards the saved scroll snapshot. Call when the content the snapshot refers
 * to is no longer valid — notably on a vault change: the old vault's offset and
 * measured section sizes are meaningless for a different vault's agenda, and
 * restoring them lands the user at an arbitrary position (often near the top,
 * showing months-old done tasks). Pairs with setting `scrollToTodayOnce`.
 */
export function resetAgendaScroll(): void {
  calendarView.setState({ agendaScrollOffset: 0, agendaScrollMeasurements: [] })
}

/**
 * Returns the values to seed `useVirtualizer` with so a remount restores the
 * previous scroll position. Call **before** creating the virtualizer.
 *
 * Reads the store snapshot once via getState() rather than subscribing —
 * these values only ever matter as useVirtualizer's initial* options, which
 * it only honors on the very first render, so there's nothing for a
 * subscription to usefully re-render this component for.
 *
 * @param skip when true (scroll-to-today pending) restore is suppressed — the
 *   virtualizer starts at offset 0 and the caller scrolls to today instead.
 */
export function useAgendaScrollRestore(skip: boolean): {
  initialOffset: number
  initialMeasurementsCache: VirtualItem[]
} {
  const { agendaScrollOffset, agendaScrollMeasurements } = calendarView.getState()
  return {
    initialOffset: skip ? 0 : agendaScrollOffset,
    initialMeasurementsCache: agendaScrollMeasurements,
  }
}

/**
 * Snapshots the scroll offset and measured sizes on unmount so the next mount can
 * restore them. Call **after** creating the virtualizer (it needs the instance).
 */
export function useSaveAgendaScroll(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  virtualizer: AgendaVirtualizer,
): void {
  useLayoutEffect(() => () => {
    calendarView.setState({
      agendaScrollOffset: scrollRef.current?.scrollTop ?? calendarView.getState().agendaScrollOffset,
      agendaScrollMeasurements: virtualizer.takeSnapshot(),
    })
  }, [scrollRef, virtualizer])
}
