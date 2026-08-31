import { useEffect, useRef } from 'react'
import { calendarView, toggleQuickNav } from './viewState'

/** Vertical swipe distance (px) needed to trigger the toggle — big enough
 * that an incidental drag over the topbar (e.g. while reaching for a button)
 * doesn't flip the panel by accident. */
const THRESHOLD = 48

/**
 * Attaches a vertical swipe gesture to the returned ref's element as an
 * alternate way to open/close the topbar's quick-nav panel, alongside the
 * label's own disclosure button (see PagedTopbar/_app.tsx). Swiping down
 * opens the panel, swiping up closes it — each only when the panel isn't
 * already in that state, so a swipe in the "wrong" direction (or one too
 * short to cross THRESHOLD) is a no-op rather than fighting a tap on one of
 * the buttons this same element hosts (Menu, Today, the chevrons, …).
 *
 * No touchmove tracking or drag-following animation — this is a plain
 * threshold toggle, not a drag-to-reveal gesture, so touchend is all it
 * needs and nothing here competes with page scroll for touchmove.
 *
 * Reads quickNavOpen straight from the store rather than via the
 * `useQuickNavOpen` hook so the listeners can be attached once for
 * `enabled`'s lifetime instead of rebinding on every toggle.
 */
export function useQuickNavSwipe<T extends HTMLElement>(enabled: boolean): React.RefObject<T | null> {
  const ref = useRef<T>(null)

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    let sy = 0
    let tracking = false

    function onTouchStart(e: TouchEvent) {
      // Ignore multi-touch gestures (pinch-zoom etc.) entirely.
      tracking = e.touches.length === 1
      sy = tracking ? e.touches[0]!.clientY : 0
    }

    function onTouchEnd(e: TouchEvent) {
      if (!tracking) return
      tracking = false
      const dy = e.changedTouches[0]!.clientY - sy
      const isOpen = calendarView.getState().quickNavOpen
      if (dy > THRESHOLD && !isOpen) toggleQuickNav()
      else if (dy < -THRESHOLD && isOpen) toggleQuickNav()
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [enabled])

  return ref
}
