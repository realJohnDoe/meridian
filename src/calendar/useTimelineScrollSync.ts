import { useCallback, useRef } from 'react'
import { HP, TOP_PAD, DEFAULT_SCROLL_HOUR } from './timelineGeometry'

interface TimelineScrollSync {
  registerScroller: (key: string, el: HTMLDivElement | null) => void
  handleVerticalScroll: (key: string, scrollTop: number) => void
  getInitialScrollTop: () => number
}

/**
 * Vertical scroll-sync layer shared by the day and week carousels: each pane
 * owns its own timeline scroller, and scrolling one mirrors the position to
 * its siblings, so the time of day you were looking at carries across a
 * swipe instead of resetting to 7am. A pane preserved across a swipe (keyed
 * reconciliation — see useCarousel) simply keeps its own scrollTop untouched;
 * a freshly-mounted pane seeds from the shared offset (see the pane's own
 * mount effect, which calls getInitialScrollTop), so there's nothing to
 * correct on commit either way.
 */
export function useTimelineScrollSync(): TimelineScrollSync {
  const scrollersRef = useRef(new Map<string, HTMLDivElement>())
  const sharedTopRef = useRef(DEFAULT_SCROLL_HOUR * HP + TOP_PAD)
  const vSyncingRef = useRef(false)

  const registerScroller = useCallback((key: string, el: HTMLDivElement | null) => {
    if (el) scrollersRef.current.set(key, el)
    else scrollersRef.current.delete(key)
  }, [])

  const handleVerticalScroll = useCallback((key: string, scrollTop: number) => {
    if (vSyncingRef.current) return
    sharedTopRef.current = scrollTop
    vSyncingRef.current = true
    mirrorScrollTop(scrollersRef.current, key, scrollTop)
    requestAnimationFrame(() => { vSyncingRef.current = false })
  }, [])

  const getInitialScrollTop = useCallback(() => sharedTopRef.current, [])

  return { registerScroller, handleVerticalScroll, getInitialScrollTop }
}

// Plain helper, deliberately outside the hook: writing to a DOM element
// pulled out of a ref-held Map inside a useCallback trips the React
// Compiler's immutability analysis (it treats the element as a frozen "hook
// argument" once it's flowed through registerScroller's callback param) —
// moving the actual mutation into an ordinary function sidesteps that.
function mirrorScrollTop(scrollers: Map<string, HTMLDivElement>, exceptKey: string, scrollTop: number) {
  for (const [k, el] of scrollers) {
    if (k !== exceptKey) el.scrollTop = scrollTop
  }
}
