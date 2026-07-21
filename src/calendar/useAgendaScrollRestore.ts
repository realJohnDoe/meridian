import { useLayoutEffect } from 'react'
import type { Virtualizer, VirtualItem } from '@tanstack/react-virtual'

/**
 * Persists the agenda's scroll position across remounts (e.g. navigating to the
 * month/day view and back). Lives module-level so it survives unmount.
 *
 * Two pieces are stored together:
 *   - `offset`       — the scroll position, fed to the virtualizer's initialOffset.
 *   - `measurements` — the measured section sizes (takeSnapshot), fed to
 *     initialMeasurementsCache. Without these the fresh virtualizer re-estimates
 *     every off-screen section, so the same pixel offset maps to different content
 *     and the list drifts ~one section per round-trip.
 */
let saved: { offset: number; measurements: VirtualItem[] } = { offset: 0, measurements: [] }

type AgendaVirtualizer = Virtualizer<HTMLDivElement, Element>

/**
 * Discards the saved scroll snapshot. Call when the content the snapshot refers
 * to is no longer valid — notably on a vault change: the old vault's offset and
 * measured section sizes are meaningless for a different vault's agenda, and
 * restoring them lands the user at an arbitrary position (often near the top,
 * showing months-old done tasks). Pairs with setting `scrollToTodayOnce`.
 */
export function resetAgendaScroll(): void {
  saved = { offset: 0, measurements: [] }
}

/**
 * Returns the values to seed `useVirtualizer` with so a remount restores the
 * previous scroll position. Call **before** creating the virtualizer.
 *
 * @param skip when true (scroll-to-today pending) restore is suppressed — the
 *   virtualizer starts at offset 0 and the caller scrolls to today instead.
 */
export function useAgendaScrollRestore(skip: boolean): {
  initialOffset: number
  initialMeasurementsCache: VirtualItem[]
} {
  return {
    initialOffset: skip ? 0 : saved.offset,
    initialMeasurementsCache: saved.measurements,
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
    saved = {
      offset: scrollRef.current?.scrollTop ?? saved.offset,
      measurements: virtualizer.takeSnapshot(),
    }
  }, [scrollRef, virtualizer])
}
