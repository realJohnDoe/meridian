import { useEffect, type RefObject } from 'react'
import { findScrollParent } from '@/lib/scrollParent'
import { useVisualViewportHeight, useVisualViewportOffsetTop } from './use-visual-viewport'

const MARGIN = 16

// Keeps `ref`'s element visible above the on-screen keyboard while `active`.
// A plain autofocus relies on the browser's built-in scroll-into-view, which
// fires immediately on focus — before iOS has finished shrinking the visual
// viewport for the keyboard — so an element that was visible at focus time
// can end up hidden once the keyboard finishes opening. Re-checking whenever
// the visual viewport actually resizes (mirrors useFloatingCombobox's
// keyboard-aware nudge) catches that case; the delta-based nudge is
// self-limiting, so no "already scrolled" guard is needed.
export function useScrollIntoViewAboveKeyboard(active: boolean, ref: RefObject<HTMLElement | null>) {
  const viewportHeight    = useVisualViewportHeight()
  const viewportOffsetTop = useVisualViewportOffsetTop()

  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return

    const rect = el.getBoundingClientRect()
    const visibleTop    = viewportOffsetTop ?? 0
    const visibleBottom = visibleTop + (viewportHeight ?? window.innerHeight)

    let delta = 0
    if (rect.bottom > visibleBottom - MARGIN) delta = rect.bottom - (visibleBottom - MARGIN)
    else if (rect.top < visibleTop + MARGIN) delta = rect.top - (visibleTop + MARGIN)

    if (Math.abs(delta) > 4) {
      findScrollParent(el)?.scrollBy({ top: delta, behavior: 'smooth' })
    }
  }, [active, viewportHeight, viewportOffsetTop, ref])
}
