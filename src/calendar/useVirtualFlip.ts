import { useLayoutEffect, useRef } from 'react'
import type { VirtualItem } from '@tanstack/react-virtual'

// Same clock as FlipList, so a row that glides here is indistinguishable from
// one gliding in a non-virtualized list (OccurrenceList, ItemsList, Sidebar).
const DURATION = 350
const EASING   = 'cubic-bezier(.4,0,.2,1)'

/** Marks the element a row's glide is applied to. See the hook doc below. */
export const FLIP_KEY_ATTR = 'data-flip-key'

/**
 * FLIP for a virtualized list: rows glide between positions rather than
 * jumping there when the list's contents change.
 *
 * FlipList can't do this job. It queries one container for every row it owns
 * and caches their measured positions per instance, which assumes a section
 * owns a contiguous, fully-mounted DOM subtree — a virtualizer mounts a
 * sliding window instead. Worse, it animates `transform`, the very property
 * the virtualizer writes to position each item, and its `translateY()` helper
 * would read the virtualizer's offset back as if it were an in-flight glide.
 *
 * So this measures nothing from the DOM: the virtualizer already knows every
 * row's layout position, and comparing `VirtualItem.start` across commits is
 * both cheaper and exact.
 *
 * Two things it needs from the caller, both load-bearing:
 *
 *  1. **The animated element must not be the one the virtualizer positions.**
 *     A WAAPI animation outranks inline style in the cascade, so animating the
 *     positioned element to `translateY(0)` would override its
 *     `translateY(start)` and stack every mounted row at the top of the list.
 *     The caller renders an inner wrapper carrying FLIP_KEY_ATTR; that is what
 *     gets animated, leaving the outer transform untouched.
 *
 *  2. **`rowsKey` must change only when the row *data* changed** — not on
 *     every render. `start` also shifts when a row above is measured to a
 *     height different from its estimate, which happens constantly while
 *     scrolling through not-yet-measured rows. Animating those would make the
 *     whole list shimmer during an ordinary scroll. Gating on the identity of
 *     the rows array means a glide only ever fires for a real change: a task
 *     completed, deleted, or re-sorted.
 *
 * `isScrolling` is a second, weaker guard for the case where the data does
 * change mid-scroll — the glide would fight the scroll, so skip it.
 */
export function useVirtualFlip(
  containerRef: React.RefObject<HTMLElement | null>,
  virtualItems: VirtualItem[],
  rowsKey: unknown,
  isScrolling: boolean,
): void {
  const prevStartsRef = useRef<Map<string, number>>(new Map())
  const prevRowsKeyRef = useRef<unknown>(undefined)
  const animsRef = useRef<Animation[]>([])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const starts = new Map<string, number>()
    for (const vi of virtualItems) starts.set(String(vi.key), vi.start)

    const prev = prevStartsRef.current
    const firstRun = prevRowsKeyRef.current === undefined
    const rowsChanged = !firstRun && prevRowsKeyRef.current !== rowsKey

    // Recorded unconditionally, including on the renders we don't animate: the
    // next data change has to glide from where the rows actually are now, which
    // includes any pure-measurement shifts that happened in between.
    prevStartsRef.current = starts
    prevRowsKeyRef.current = rowsKey

    // A glide is pure polish, and this runs inside a layout effect where an
    // exception takes the whole agenda down with it. Skip rather than throw
    // where the Web Animations API isn't there (jsdom, notably).
    if (!rowsChanged || isScrolling || typeof Element.prototype.animate !== 'function') return

    // A row can move further than the viewport when a lot of content above it
    // appears or disappears at once (a filter change dropping thousands of
    // overdue rows, say). The virtualizer compensates the scroll offset so the
    // row stays put on screen; animating that delta would send it flying across
    // the viewport instead. Cap the glide at one screen.
    const maxGlide = container.clientHeight || Infinity

    const moved: { key: string; delta: number }[] = []
    for (const [key, start] of starts) {
      const before = prev.get(key)
      // No previous position means the row just scrolled (or was added) into
      // the window — there's nowhere to glide from. Matches FlipList, which
      // also leaves newcomers alone.
      if (before === undefined) continue
      const delta = before - start
      if (Math.abs(delta) <= 1 || Math.abs(delta) > maxGlide) continue
      moved.push({ key, delta })
    }
    if (!moved.length) return

    // One query for the whole window (~a few dozen elements), rather than a
    // per-key selector — the keys are built from file slugs and dates and
    // would otherwise need escaping.
    const els = new Map<string, HTMLElement>()
    for (const el of container.querySelectorAll<HTMLElement>(`[${FLIP_KEY_ATTR}]`)) {
      const k = el.getAttribute(FLIP_KEY_ATTR)
      if (k !== null) els.set(k, el)
    }

    for (const a of animsRef.current) a.cancel()
    animsRef.current = []
    for (const { key, delta } of moved) {
      const el = els.get(key)
      if (!el) continue
      animsRef.current.push(el.animate(
        [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
        { duration: DURATION, easing: EASING },
      ))
    }
  }, [containerRef, virtualItems, rowsKey, isScrolling])

  useLayoutEffect(() => () => {
    for (const a of animsRef.current) a.cancel()
    animsRef.current = []
  }, [])
}
