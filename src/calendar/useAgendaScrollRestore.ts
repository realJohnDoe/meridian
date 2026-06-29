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
