import { useEffect, type RefObject } from 'react'
import { findScrollParent } from '@/lib/scrollParent'
import { readVisibleViewport } from './use-visual-viewport'

const MARGIN = 16

// Keeps `ref`'s element visible above the on-screen keyboard while `active`.
// A plain autofocus relies on the browser's built-in scroll-into-view, which
// fires immediately on focus — before the keyboard has finished opening and
// shrinking the visible area — so an element that was visible at focus time
// can end up hidden once the keyboard settles. Re-checking on resize catches
// that case (mirrors useFloatingCombobox's keyboard-aware nudge).
//
// Measures through readVisibleViewport() rather than reading
// window.visualViewport here, so the cross-browser fallbacks (notably Firefox
// for Android, which has no visualViewport at all) live in one place.
export function useScrollIntoViewAboveKeyboard(active: boolean, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return

    function recompute() {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const { top: visibleTop, height } = readVisibleViewport()
      const visibleBottom = visibleTop + height

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
