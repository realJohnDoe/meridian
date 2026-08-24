import { useEffect, type RefObject } from 'react'
import { findScrollParent } from '@/lib/scrollParent'

const MARGIN = 16

// Keeps `ref`'s element visible above the on-screen keyboard while `active`.
// A plain autofocus relies on the browser's built-in scroll-into-view, which
// fires immediately on focus — before the keyboard has finished opening and
// shrinking the visible area — so an element that was visible at focus time
// can end up hidden once the keyboard settles. Re-checking on resize catches
// that case (mirrors useFloatingCombobox's keyboard-aware nudge).
//
// Reads `window.visualViewport` directly inside the handler rather than via
// the useVisualViewportHeight/OffsetTop hooks, and always also listens to
// plain `resize` — Firefox for Android has no visualViewport support at all,
// and there its keyboard genuinely shrinks window.innerHeight and fires a
// real `resize` event, so that's the only signal available there.
export function useScrollIntoViewAboveKeyboard(active: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return

    function recompute() {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vv = window.visualViewport
      const visibleTop    = vv?.offsetTop ?? 0
      const visibleBottom = visibleTop + (vv?.height ?? window.innerHeight)

      let delta = 0
      if (rect.bottom > visibleBottom - MARGIN) delta = rect.bottom - (visibleBottom - MARGIN)
      else if (rect.top < visibleTop + MARGIN) delta = rect.top - (visibleTop + MARGIN)

      if (Math.abs(delta) > 4) {
        findScrollParent(el)?.scrollBy({ top: delta, behavior: 'smooth' })
      }
    }

    recompute()
    window.addEventListener('resize', recompute)
    const vv = window.visualViewport
    vv?.addEventListener('resize', recompute)
    vv?.addEventListener('scroll', recompute)
    return () => {
      window.removeEventListener('resize', recompute)
      vv?.removeEventListener('resize', recompute)
      vv?.removeEventListener('scroll', recompute)
    }
  }, [active, ref])
}
