import { useEffect, useRef } from 'react'

/**
 * The agenda's whole scroll story rests on one unstated assumption: that the
 * element it hands `getScrollElement` is the thing that actually scrolls.
 *
 * Everything downstream takes that on faith. `scrollToIndex` calls `scrollTo`
 * on it, `computeAgendaScrollRestore` seeds an offset into it,
 * `useSaveAgendaScroll` banks its `scrollTop`, and `useAnchoredAgendaScroll`
 * re-pins against offsets read back from it. When an ancestor stops capping its
 * height the element simply grows to fit its content, the *document* takes over
 * the scrolling, and every one of those becomes a no-op against a number that
 * means nothing — with nothing anywhere saying so. The reported symptom was
 * "the agenda is empty and the Today button does nothing"; the console was
 * clean.
 *
 * So state the assumption where it can be checked. A fault here is always a
 * layout bug outside this component, which is why the message points at the
 * shell rather than at the virtualizer.
 */

/** The measurements the check reads, so it stays a pure function of numbers. */
export interface ScrollGeometry {
  /** The scroll element's own visible height. */
  clientHeight: number
  /** Its content height — greater than clientHeight exactly when it can scroll. */
  scrollHeight: number
  /** What the virtualizer thinks all the rows add up to. */
  totalSize: number
  /** The viewport the whole app is supposed to fit inside. */
  viewportHeight: number
}

/**
 * Describes how the scroll element is broken, or null when it is fine.
 *
 * Two distinct faults, because the shipped bug turned out not to be the obvious
 * one:
 *
 *  1. **Taller than the viewport.** This is what actually happened. The shell
 *     lost its height cap, so the scroll element grew to its full content
 *     (`clientHeight` 11152 on a 915px screen) and the document scrolled
 *     instead. Note that `totalSize` (9043) was *less* than that `clientHeight`
 *     — by the naive reading the list "fits", which is exactly why a check
 *     phrased only as "can it scroll" would have stayed quiet. A scroller
 *     nested inside a one-screen shell can never legitimately be taller than
 *     the screen.
 *  2. **Content to show and no overflow to show it in.** The generic case: the
 *     virtualizer has more rows than fit, yet the element reports no
 *     scrollable overflow.
 *
 * `clientHeight === 0` is neither: nothing has been laid out yet (a fresh
 * mount, a hidden tab, any jsdom test). Not knowing is not the same as broken.
 */
export function scrollabilityFault(g: ScrollGeometry | null): string | null {
  if (!g) return null
  const { clientHeight, scrollHeight, totalSize, viewportHeight } = g
  if (clientHeight === 0) return null

  const shell =
    'Something above the agenda stopped capping its height, so the document is scrolling instead — scrollToIndex, ' +
    'the seeded initial offset and the scroll anchor are all no-ops until that is fixed. ' +
    'See routes/_app.tsx and the shell rules in index.css.'

  if (viewportHeight > 0 && clientHeight > viewportHeight) {
    return (
      `[agenda] the scroll container is taller than the viewport: clientHeight ${clientHeight} > ` +
      `${viewportHeight}. It should be clipped to one screen and scroll its own content. ${shell}`
    )
  }
  if (totalSize > clientHeight && scrollHeight <= clientHeight) {
    return (
      `[agenda] the scroll container cannot scroll: scrollHeight ${scrollHeight} === clientHeight ${clientHeight}, ` +
      `with ${totalSize}px of virtualized rows to show. ${shell}`
    )
  }
  return null
}

/** Reads the live geometry off a scroll element, or null when there isn't one. */
function measure(el: HTMLElement | null): ScrollGeometry | null {
  if (!el) return null
  return {
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
    totalSize: 0,
    viewportHeight: el.ownerDocument.defaultView?.innerHeight ?? 0,
  }
}

/**
 * Reports a broken scroll element once per mount, in development only.
 *
 * Dev-only on purpose: this is a bug in our own layout, not a condition a user
 * can be in and do anything about, so there is nobody in production for the
 * message to help. Once per mount because the fault is a property of the
 * layout, not of any one render — repeating it on every row change would bury
 * it.
 */
export function useScrollabilityWarning(
  scrollRef: React.RefObject<HTMLElement | null>,
  totalSize: number,
): void {
  const reportedRef = useRef(false)

  useEffect(() => {
    if (!import.meta.env.DEV || reportedRef.current) return
    const geometry = measure(scrollRef.current)
    const fault = scrollabilityFault(geometry && { ...geometry, totalSize })
    if (!fault) return
    reportedRef.current = true
    console.error(fault)
  }, [scrollRef, totalSize])
}
