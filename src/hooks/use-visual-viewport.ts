import { useLayoutEffect, useSyncExternalStore } from "react"

/**
 * The strip of the layout viewport that is currently *visible* — i.e. not
 * covered by an on-screen keyboard or other interactive widget.
 *
 * `top` is how far the visible area's top edge has moved from the layout
 * viewport's origin, `height` how tall it is, and `keyboardInset` how much
 * vertical space the keyboard is eating (0 when it's closed).
 */
export interface VisibleViewport {
  top:           number
  height:        number
  keyboardInset: number
}

/**
 * A layout/visual delta smaller than this is browser chrome (a collapsing URL
 * bar, a scrollbar gutter), not a keyboard. Desktop browsers show a few dozen
 * pixels of it permanently, so treating any delta as a keyboard would make
 * every popover on a desktop reserve space for a keyboard that isn't there.
 */
const KEYBOARD_MIN_INSET = 120

/**
 * Reads the visible viewport, portably.
 *
 * Three platforms, three levels of support, and no single API covers them:
 *
 * - **iOS/iPadOS Safari** shrinks `visualViewport` but *not* `window.innerHeight`,
 *   and does not move the layout viewport that `position: fixed` anchors to —
 *   only `visualViewport.offsetTop` shifts. So fixed, portaled content (dialogs,
 *   popovers) lays out against the full, partly keyboard-covered screen unless
 *   we correct it by hand.
 * - **Chrome/Firefox for Android** shrink `window.innerHeight` for real and fire
 *   a plain `resize`. With `interactive-widget=resizes-content` in the viewport
 *   meta (see index.html) the layout viewport shrinks too, so most of this
 *   correction becomes a no-op there — which is the point.
 * - **Firefox for Android** has no `window.visualViewport` at all. Reading it
 *   through a hook that only subscribes to `visualViewport` events means the
 *   value never updates and keyboard avoidance silently does nothing — the bug
 *   fixed in 5e7c6d2, which at the time was fixed in only one of its six
 *   consumers. Hence this single primitive: the fallback lives in one place and
 *   cannot be half-applied again.
 *
 * `navigator.virtualKeyboard` (Chrome for Android only) would give an exact
 * keyboard rect, but it requires opting the whole app out of the browser's own
 * keyboard handling (`overlaysContent = true`), which would *add* work on the
 * one platform that already behaves. Deliberately not used.
 */
export function useVisibleViewport(): VisibleViewport {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/** Just the keyboard's height, for callers that only need to reserve space. */
export function useKeyboardInset(): number {
  return useVisibleViewport().keyboardInset
}

function subscribe(onStoreChange: () => void) {
  // Always listen to the plain window `resize` too, not just visualViewport's:
  // it is the only signal Firefox for Android emits when its keyboard opens.
  window.addEventListener("resize", onStoreChange)
  const vv = window.visualViewport
  vv?.addEventListener("resize", onStoreChange)
  vv?.addEventListener("scroll", onStoreChange)
  return () => {
    window.removeEventListener("resize", onStoreChange)
    vv?.removeEventListener("resize", onStoreChange)
    vv?.removeEventListener("scroll", onStoreChange)
  }
}

// useSyncExternalStore compares snapshots by reference, so returning a fresh
// object each call would loop forever. Cache it and only rebuild when one of
// the three numbers actually changes.
let cached: VisibleViewport = { top: 0, height: 0, keyboardInset: 0 }

function getSnapshot(): VisibleViewport {
  const next = readVisibleViewport()
  if (
    next.top           === cached.top &&
    next.height        === cached.height &&
    next.keyboardInset === cached.keyboardInset
  ) return cached
  cached = next
  return next
}

// No viewport on the server: report a zero-height strip at the origin. Callers
// treat height 0 as "unknown" and fall back to their own layout.
const SERVER_SNAPSHOT: VisibleViewport = { top: 0, height: 0, keyboardInset: 0 }
function getServerSnapshot(): VisibleViewport {
  return SERVER_SNAPSHOT
}

/** The measurement itself, exported for tests and for the CSS-var publisher. */
export function readVisibleViewport(): VisibleViewport {
  if (typeof window === "undefined") return SERVER_SNAPSHOT
  const vv = window.visualViewport
  const top    = vv?.offsetTop ?? 0
  const height = vv?.height ?? window.innerHeight
  const raw    = window.innerHeight - height
  return { top, height, keyboardInset: raw > KEYBOARD_MIN_INSET ? raw : 0 }
}

/**
 * Mirrors the visible viewport onto `<html>` as custom properties, so layout
 * can be expressed in CSS (`max-h-[var(--vv-height)]`) instead of inline styles
 * threaded through every component. Mounted once, at the app root.
 */
export function useVisibleViewportCssVars(): void {
  const { top, height, keyboardInset } = useVisibleViewport()
  // Layout, not passive: these drive layout, so applying them after paint would
  // show one frame at the stale size every time the keyboard opens or closes.
  useLayoutEffect(() => {
    const s = document.documentElement.style
    s.setProperty("--vv-top", `${top}px`)
    s.setProperty("--vv-height", height ? `${height}px` : "100svh")
    s.setProperty("--kb-inset", `${keyboardInset}px`)
  }, [top, height, keyboardInset])
}
