import { startTransition, useEffect, useState } from 'react'

/**
 * False on this component's first render, flips true shortly after via a
 * transition. Pairs with deferredExpansionWindow.ts's EMPTY_EXPANSION_WINDOW:
 * every carousel pane (DayPane/WeekPane/MonthGrid) is keyed by its own
 * date/week/month string at the wrapping div in DayView/WeekView/MonthView
 * (see useCarousel), so a pane showing a new unit is always a fresh mount,
 * never a prop update to an existing one — there's no earlier `ready` to
 * reset, hence the empty deps.
 *
 * Lets a freshly-mounted pane request the cheap, reliably-empty window
 * instead of its real one for its first commit — the chrome (headers, hour
 * grid) paints the same either way, but the expensive part (occurrence
 * expansion + layout) is deferred to a follow-up low-priority render instead
 * of paying for it in the same commit that mounts the pane — which is what
 * stalls whatever brought the pane on screen (a swipe settling, a big
 * external jump like the mini-calendar's own quick-nav, or a burst of swipes
 * landing faster than the carousel's PANE_COUNT buffer can keep
 * pre-rendered).
 */
export function useReadyAfterMount(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    startTransition(() => setReady(true))
  }, [])
  return ready
}
