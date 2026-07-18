import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { snapIndex } from './snapCarousel'

// Shared mechanics behind both calendar carousels (MonthView, DayView): a
// 3-pane horizontal scroll-snap track — previous/current/next — where the
// route's current unit (a month or a date) is the source of truth and the
// carousel commits a navigation once a swipe settles. See MonthView's header
// comment for the full seam explanation (keyed panes, no-flash recenter);
// this hook is that mechanism made generic over what a "unit" is.
interface UseSnapCarouselOptions {
  /** The currently committed unit (e.g. a `YYYY-MM` month key or `YYYY-MM-DD` date key). */
  unitKey: string
  /** Maps a pane index (0 = previous, 1 = current, 2 = next) to its unit key. */
  unitAt: (idx: number) => string
  /** Called once a swipe settles on a pane other than the current one. */
  onCommit: (key: string) => void
  /**
   * Called from the live scroll position during a gesture or momentum, so a
   * label can track the swipe ahead of the commit — change-guarded
   * internally, so this fires once per pane crossed, not once per frame.
   */
  onPreview: (key: string) => void
  /**
   * Called after the seam recenter (i.e. after `unitKey` has actually
   * committed), not after a resize-driven recenter — lets the caller clear
   * any preview state now that the route is authoritative again.
   */
  onRecentered?: () => void
}

interface UseSnapCarouselResult {
  trackRef: React.RefObject<HTMLDivElement | null>
  paneKeys: [string, string, string]
  recenter: () => void
}

export function useSnapCarousel({
  unitKey, unitAt, onCommit, onPreview, onRecentered,
}: UseSnapCarouselOptions): UseSnapCarouselResult {
  const trackRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  // Cached by the resize-driven recenter below so the scroll handler (fires
  // continuously during momentum) never triggers its own layout read.
  const paneWRef = useRef(0)

  // Callbacks are kept in refs and re-synced every render rather than
  // required to be memoized by the caller — callers just pass fresh
  // closures, same as MonthView already did for its own onNavigateMonth.
  const unitAtRef = useRef(unitAt)
  useEffect(() => { unitAtRef.current = unitAt })
  const onCommitRef = useRef(onCommit)
  useEffect(() => { onCommitRef.current = onCommit })
  const onPreviewRef = useRef(onPreview)
  useEffect(() => { onPreviewRef.current = onPreview })
  const onRecenteredRef = useRef(onRecentered)
  useEffect(() => { onRecenteredRef.current = onRecentered })

  const paneKeys: [string, string, string] = [unitAt(0), unitAt(1), unitAt(2)]

  // Recenters the track on the current pane, same shape as TimeWheels'
  // scrollTop recenter: a synchronous write, then release `syncing` on the
  // next frame so the write isn't mistaken for a user scroll.
  const recenter = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    const paneW = el.getBoundingClientRect().width
    if (!paneW) return
    paneWRef.current = paneW
    syncingRef.current = true
    el.scrollLeft = paneW
    requestAnimationFrame(() => { syncingRef.current = false })
  }, [])

  // The seam: recenter synchronously before paint whenever the committed
  // unit changes, in the same commit that shifts which key each pane
  // renders — so the pixel that was at 2×paneW is now at paneW and nothing
  // visibly moves. React runs layout effects before the browser paints, so
  // there's no frame in between where the stale position is visible.
  useLayoutEffect(() => {
    recenter()
    onRecenteredRef.current?.()
  }, [unitKey, recenter])

  // Also re-centers on any track resize (e.g. the desktop sidebar's animated
  // width transition, or a viewport rotation), since a stale paneW is no
  // longer a real snap point and would otherwise let the engine re-snap to
  // an arbitrary neighbour. Deliberately doesn't call onRecentered — only a
  // committed unit change should clear a caller's preview state.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(recenter)
    ro.observe(el)
    return () => ro.disconnect()
  }, [recenter])

  // Swipe commit. Gesture-gated rather than purely geometric, so a finger
  // held stationary mid-drag on a snap point doesn't commit a navigation
  // underneath it. `syncing` is checked in the raw scroll handler rather than
  // inside the debounced callback, since the recenter's rAF release can beat
  // a ~100ms debounce to the punch. `scrollend` (where supported) is a more
  // precise trigger than the debounce and is preferred when available; the
  // debounce remains as the fallback (Safari only shipped `scrollend` in 18.2).
  useEffect(() => {
    const el = trackRef.current
    if (!el) return

    let dragging = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let lastPreviewKey: string | null = null

    const checkSettle = () => {
      if (syncingRef.current || dragging) return
      const w = el.getBoundingClientRect().width
      const idx = snapIndex(el.scrollLeft, w)
      if (idx === null || idx === 1) return
      onCommitRef.current(unitAtRef.current(idx))
    }

    const scheduleCheck = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(checkSettle, 100)
    }

    // Updates the preview from the live scroll position during momentum,
    // rather than waiting for the gesture to settle and the route to commit
    // (a Chrome trace of a real flick showed that lag firsthand on the month
    // carousel). Uses the cached paneWRef rather than measuring here, since
    // this runs on every scroll event during momentum.
    const updatePreview = () => {
      const w = paneWRef.current
      if (!w) return
      const idx = Math.max(0, Math.min(2, Math.round(el.scrollLeft / w)))
      const key = unitAtRef.current(idx)
      if (key === lastPreviewKey) return
      lastPreviewKey = key
      onPreviewRef.current(key)
    }

    const onScroll = () => {
      if (syncingRef.current) return
      updatePreview()
      scheduleCheck()
    }
    const onTouchStart = () => { dragging = true }
    const onTouchEnd = () => {
      dragging = false
      scheduleCheck()
    }
    const onScrollEnd = () => {
      clearTimeout(idleTimer)
      checkSettle()
    }

    const supportsScrollend = 'onscrollend' in window
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })
    if (supportsScrollend) el.addEventListener('scrollend', onScrollEnd)

    return () => {
      clearTimeout(idleTimer)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      if (supportsScrollend) el.removeEventListener('scrollend', onScrollEnd)
    }
  }, [])

  return { trackRef, paneKeys, recenter }
}
