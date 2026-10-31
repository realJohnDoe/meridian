import { useEffect, useRef } from 'react'

interface UseCarouselPreviewOptions {
  get: () => string | null
  set: (key: string | null) => void
}

interface UseCarouselPreviewResult {
  onPreview: (key: string) => void
  onRecentered: () => void
}

/**
 * Wires up the `onPreview`/`onRecentered` pair `useCarousel` expects for a
 * "preview string, cleared once the swipe actually commits" slot — the
 * pattern MonthView/DayView/WeekView each repeated verbatim for their own
 * slot in the shared `calendarView` store (`monthPreview`/`dayPreview`/
 * `weekPreview`), and that MiniMonth now repeats too for its own local one.
 *
 * Also clears the slot on unmount: a swipe left in flight (e.g. the user
 * navigates away via the sidebar before it settles) would otherwise leave a
 * stale preview behind — harmless for local `useState`, which unmounts with
 * the component, but load-bearing for `calendarView`'s shared store, which
 * would otherwise briefly mislabel the topbar on the next visit to the route.
 */
export function useCarouselPreview({ get, set }: UseCarouselPreviewOptions): UseCarouselPreviewResult {
  // Mount ref, not an exhaustive-deps suppression (which makes the React
  // Compiler skip the hook): cleanup must fire on unmount only, not per render.
  const setRef = useRef(set)
  useEffect(() => () => setRef.current(null), [])
  return {
    onPreview: set,
    // Guarded so a stray fire while already clear does nothing — mirrors
    // MonthView/DayView/WeekView's own inline check before this was shared.
    onRecentered: () => { if (get() !== null) set(null) },
  }
}
