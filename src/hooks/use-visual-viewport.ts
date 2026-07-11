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
