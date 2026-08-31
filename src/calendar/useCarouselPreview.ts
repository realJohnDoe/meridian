import { useEffect } from 'react'

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `set` is expected to be a stable setState/store-setter identity, not a fresh closure each render; re-running this per render would fire the cleanup (clearing the preview) on every unrelated render.
  useEffect(() => () => set(null), [])
  return {
    onPreview: set,
    // Guarded so a stray fire while already clear does nothing — mirrors
    // MonthView/DayView/WeekView's own inline check before this was shared.
    onRecentered: () => { if (get() !== null) set(null) },
  }
}
