import { useEffect, useLayoutEffect, useRef } from 'react'
import useEmblaCarousel from 'embla-carousel-react'

// Shared mechanics behind both calendar carousels (MonthView, DayView): a
// horizontal pager of `paneCount` panes centered on the route's current unit
// (a month or a date), which stays the source of truth. Embla owns the
// gesture — finger-synced transform drag, one-page-per-swipe snapping
// (skipSnaps: false, so even a hard fling can't skip past the adjacent pane),
// axis-locking (vertical drags pass through to a pane's own scroller), and
// edge resistance.
//
// The label preview updates on Embla's `select` (fires the instant the finger
// lifts and a target pane is locked). The route commits once the snap has
// landed — on `settle`, OR a short fallback timer if `settle` doesn't arrive
// (Embla's settle is emitted from its rAF render loop, and we saw it fail to
// reach us on a real device, which stranded the pane window at ±2 panes and
// made anything further unreachable by swipe). Committing after the animation
// (rather than on select) keeps the panes from re-rendering mid-swipe, so the
// snap animation runs uninterrupted and the post-commit recenter — reInit +
// jump to center, with the committed pane already centered — moves nothing.
interface UseCarouselOptions {
  /** The route's current unit (e.g. a `YYYY-MM` month key or `YYYY-MM-DD` date key). */
  unitKey: string
  /** Number of simultaneously-mounted panes — must be odd. Expected to be a stable constant. */
  paneCount: number
  /** Maps an offset from the current unit (e.g. -2..+2 for paneCount=5) to its unit key. */
  unitAt: (offset: number) => string
  /** Commit a navigation to the settled pane's unit (may be more than one unit away if a burst of swipes landed before this fired). */
  onCommit: (key: string) => void
  /** Update a preview label from the pane the gesture just picked, ahead of the commit. */
  onPreview: (key: string) => void
  /** Called after the post-commit recenter — lets the caller clear its preview state. */
  onRecentered?: () => void
}

interface UseCarouselResult {
  /** Goes on the Embla viewport (overflow-hidden); its first child must be the flex container wrapping the panes. */
  emblaRef: (node: HTMLElement | null) => void
  paneKeys: string[]
}

// Fallback delay for the commit if Embla's `settle` event doesn't arrive.
// Comfortably longer than the snap animation so it never commits mid-animation
// (which would recenter mid-slide and flash). `settle` normally beats it; the
// timer is insurance so a missed settle can't strand the window at its edge.
const COMMIT_FALLBACK_MS = 500

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
    watchSlides: false,     // panes are keyed off the route; we reInit manually
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

  useEffect(() => {
    if (!emblaApi) return
    let fallbackId: ReturnType<typeof setTimeout> | undefined

    // Commit the settled pane's unit. Guarded so the recenter's own
    // scrollTo(center) — which lands on the center pane — is a no-op, and so a
    // stray fire while already centered does nothing.
    const commit = () => {
      clearTimeout(fallbackId)
      const offset = emblaApi.selectedScrollSnap() - center
      if (offset === 0) return
      onCommitRef.current(unitAtRef.current(offset))
    }

    const onSelect = () => {
      const offset = emblaApi.selectedScrollSnap() - center
      if (offset === 0) return
      onPreviewRef.current(unitAtRef.current(offset))
      // Commit when the snap settles; the timer is a fallback if `settle`
      // doesn't arrive. A follow-up swipe reschedules it, so during a rapid
      // burst the commit waits for the last swipe.
      clearTimeout(fallbackId)
      fallbackId = setTimeout(commit, COMMIT_FALLBACK_MS)
    }

    emblaApi.on('select', onSelect)
    emblaApi.on('settle', commit)
    return () => {
      clearTimeout(fallbackId)
      emblaApi.off('select', onSelect)
      emblaApi.off('settle', commit)
    }
  }, [emblaApi, center])

  // Recenter seam: once the committed unit changes, the keyed panes have
  // shifted so the just-committed pane sits at `center`. reInit picks up the
  // new pane set and the jump to center lands on the identical pixel (the
  // committed pane was already centered at commit time), so nothing visibly
  // moves. Layout effect → runs before paint.
  useLayoutEffect(() => {
    if (!emblaApi) return
    emblaApi.reInit()
    emblaApi.scrollTo(center, true)
    onRecenteredRef.current?.()
  }, [unitKey, emblaApi, center])

  return { emblaRef, paneKeys }
}
