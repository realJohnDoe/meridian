import { useCallback, useSyncExternalStore } from "react"

// iOS/iPadOS Safari shrinks window.visualViewport (not window.innerHeight) when the
// on-screen keyboard opens. Fixed-position, portaled content (dialogs, popovers) is
// laid out against the layout viewport by default, so it can end up positioned behind
// the keyboard. Components use this to cap their height to what's actually visible.
export function useVisualViewportHeight(): number | undefined {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const vv = window.visualViewport
    if (!vv) return () => {}
    vv.addEventListener("resize", onStoreChange)
    vv.addEventListener("scroll", onStoreChange)
    return () => {
      vv.removeEventListener("resize", onStoreChange)
      vv.removeEventListener("scroll", onStoreChange)
    }
  }, [])

  const getSnapshot = useCallback(() => window.visualViewport?.height, [])
  const getServerSnapshot = useCallback(() => undefined, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Fixed-position elements are anchored to the layout viewport's origin, which iOS
// doesn't move when the keyboard opens — only visualViewport.offsetTop shifts, to
// tell us how far the visible area's top edge has moved from that origin. Combine
// with the height above to compute a `top` that actually centers within what's
// visible, instead of the (keyboard-obscured) full layout viewport.
export function useVisualViewportOffsetTop(): number | undefined {
  const subscribe = useCallback((onStoreChange: () => void) => {
    const vv = window.visualViewport
    if (!vv) return () => {}
    vv.addEventListener("resize", onStoreChange)
    vv.addEventListener("scroll", onStoreChange)
    return () => {
      vv.removeEventListener("resize", onStoreChange)
      vv.removeEventListener("scroll", onStoreChange)
    }
  }, [])

  const getSnapshot = useCallback(() => window.visualViewport?.offsetTop, [])
  const getServerSnapshot = useCallback(() => undefined, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
