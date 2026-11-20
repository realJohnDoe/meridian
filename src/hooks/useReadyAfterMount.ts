import { startTransition, useEffect, useState } from 'react'

/**
 * False on this component's first render, flips true shortly after via a
 * transition — so a component can commit a cheap first frame and render its
 * expensive part in a follow-up, interruptible render instead of in the same
 * commit that mounts it. There's no earlier `ready` to reset, hence the empty
 * deps: a component showing something new must be a fresh mount.
 *
 * Two uses:
 *
 * - **Carousel panes** (MonthGrid). Every pane is keyed by its own month at
 *   MonthView's wrapping div (see useCarousel), so a pane showing a new unit
 *   is always a fresh mount. Its first commit requests
 *   deferredExpansionWindow.ts's EMPTY_EXPANSION_WINDOW instead of its real
 *   one: the cells paint the same either way, and the occurrence expansion
 *   no longer stalls whatever brought the pane on screen (a swipe settling,
 *   the mini-calendar's quick-nav, a burst of swipes).
 *
 * - **Route pages** (the agenda, Month, an existing entry's editor). These
 *   show their skeleton for the first commit. A navigation can't be made
 *   non-urgent from the outside: TanStack Router already commits it inside
 *   `startTransition`, but every component reads router state through
 *   `useSyncExternalStore`, whose updates React always renders synchronously.
 *   So the whole new page used to mount inside the tap (or the `popstate`
 *   that Back fires), and the tap's pressed state waited for all of it.
 */
export function useReadyAfterMount(): boolean {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    startTransition(() => setReady(true))
  }, [])
  return ready
}
