import { useEffect, useLayoutEffect, useRef } from 'react'
import useEmblaCarousel from 'embla-carousel-react'

// Shared mechanics behind both calendar carousels (MonthView, DayView): a
// horizontal pager of `paneCount` panes centered on the route's current unit
// (a month or a date), which stays the source of truth. Embla owns the
// gesture — finger-synced transform drag, one-page-per-swipe snapping
// (skipSnaps: false, so even a hard fling can't skip past the adjacent pane),
// axis-locking (vertical drags pass through to a pane's own scroller), and
// edge resistance — none of which native CSS scroll-snap could do reliably
// (Chromium ignores scroll-snap-stop for flings, and its momentum coasts
// across multiple pages). We drive the route from Embla's events and recenter
// the pane window after each commit.
//
// Timing of the two events matters and is deliberate:
//   • `select` fires the instant the finger lifts and Embla picks a target
//     pane — used only to update the preview label immediately, ahead of the
//     route commit.
//   • `settle` fires when the snap animation has fully landed, i.e. the target
//     pane is exactly centered — used to commit the route. Committing here
//     (not on select) is what lets the recenter below be pixel-identical: the
//     just-committed pane is already centered, so re-keying the panes and
//     jumping the window back to center moves nothing on screen.
interface UseCarouselOptions {
  /** The currently committed unit (e.g. a `YYYY-MM` month key or `YYYY-MM-DD` date key). */
  unitKey: string
  /** Number of simultaneously-mounted panes — must be odd. Expected to be a stable constant. */
  paneCount: number
  /** Maps an offset from the current unit (e.g. -2..+2 for paneCount=5) to its unit key. */
  unitAt: (offset: number) => string
  /** Commit a navigation to the settled pane's unit (may be more than one unit away if a burst of swipes landed before this fired). */
  onCommit: (key: string) => void
  /** Update a preview label from the pane the gesture just picked, ahead of the commit. */
  onPreview: (key: string) => void
  /** Called after the post-commit recenter — lets the caller clear its preview state now the route is authoritative again. */
  onRecentered?: () => void
}

interface UseCarouselResult {
  /** Goes on the Embla viewport (overflow-hidden); its first child must be the flex container wrapping the panes. */
  emblaRef: (node: HTMLElement | null) => void
  paneKeys: string[]
}

export function useCarousel({
  unitKey, paneCount, unitAt, onCommit, onPreview, onRecentered,
}: UseCarouselOptions): UseCarouselResult {
  const center = Math.floor(paneCount / 2)

  const [emblaRef, emblaApi] = useEmblaCarousel({
    axis: 'x',
    align: 'center',
    startIndex: center,
    containScroll: false,   // allow scrolling all the way to the edge panes
    skipSnaps: false,       // one pane per swipe, even on a hard fling
    loop: false,
    watchSlides: false,     // we reInit manually on unitKey change (below)
    duration: 18,           // snap animation speed (Embla units) — snappy but smooth
  })

  // Callbacks are kept in refs and re-synced every render rather than required
  // to be memoized by the caller — callers just pass fresh closures.
  const unitAtRef = useRef(unitAt)
  useEffect(() => { unitAtRef.current = unitAt })
  const onCommitRef = useRef(onCommit)
  useEffect(() => { onCommitRef.current = onCommit })
  const onPreviewRef = useRef(onPreview)
  useEffect(() => { onPreviewRef.current = onPreview })
  const onRecenteredRef = useRef(onRecentered)
  useEffect(() => { onRecenteredRef.current = onRecentered })

  const paneKeys = Array.from({ length: paneCount }, (_, i) => unitAt(i - center))

  // Preview on select — fires at pointer-release, so the label flips to the
  // target month/day immediately, before the settle-driven route commit.
  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => {
      const sel = emblaApi.selectedScrollSnap()
      if (sel === center) return
      onPreviewRef.current(unitAtRef.current(sel - center))
    }
    emblaApi.on('select', onSelect)
    return () => { emblaApi.off('select', onSelect) }
  }, [emblaApi, center])

  // Commit on settle — the animation has landed, target pane is exactly
  // centered. The center guard also makes the recenter's own settle a no-op.
  useEffect(() => {
    if (!emblaApi) return
    const onSettle = () => {
      const sel = emblaApi.selectedScrollSnap()
      if (sel === center) return
      onCommitRef.current(unitAtRef.current(sel - center))
    }
    emblaApi.on('settle', onSettle)
    return () => { emblaApi.off('settle', onSettle) }
  }, [emblaApi, center])

  // Recenter seam: once the committed unit changes, the keyed panes have
  // shifted so the just-committed pane sits at `center`. reInit picks up the
  // new pane set and the jump to center lands on the identical pixel position
  // (the committed pane was already centered at settle), so nothing visibly
  // moves. Layout effect → runs before paint.
  useLayoutEffect(() => {
    if (!emblaApi) return
    emblaApi.reInit()
    emblaApi.scrollTo(center, true)
    onRecenteredRef.current?.()
  }, [unitKey, emblaApi, center])

  return { emblaRef, paneKeys }
}
