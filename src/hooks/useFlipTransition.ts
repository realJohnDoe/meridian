import { useRef, useLayoutEffect } from 'react'
import type React from 'react'

/**
 * FLIP transition for rows identified by `[attr]` inside a container.
 * Whenever a row's position shifts between renders — because it moved within
 * the list, or because a sibling entered/left — it animates from its
 * previous position to its new one via `transform: translateY()`. The diff
 * is purely per-key (no same-count requirement), so removing or adding a row
 * elsewhere in the container makes the rest of the list glide into its new
 * position instead of snapping.
 */
export function useFlipTransition<T>(
  containerRef: React.RefObject<HTMLElement | null>,
  items: T[],
  attr: string,
) {
  const prevTops = useRef<Record<string, number>>({})

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const containerTop = container.getBoundingClientRect().top
    const wraps = container.querySelectorAll<HTMLElement>(`[${attr}]`)
    const newTops: Record<string, number> = {}
    const rafs: number[] = []

    // Single delegated listener instead of one per animated row — resets
    // `transition` on whichever row's transform animation just finished.
    function onTransitionEnd(e: TransitionEvent) {
      if (e.propertyName === 'transform' && e.target instanceof HTMLElement) {
        e.target.style.transition = ''
      }
    }
    container.addEventListener('transitionend', onTransitionEnd)

    // Phase 1 (READ): measure every row before writing anything. Interleaving
    // reads and writes per-row here would force a synchronous reflow on each
    // moved row instead of one reflow for the whole batch.
    const moved: { wrap: HTMLElement; dy: number }[] = []
    wraps.forEach(wrap => {
      const key = wrap.getAttribute(attr)!
      const curr = wrap.getBoundingClientRect().top - containerTop
      const prev = prevTops.current[key]
      if (prev !== undefined) {
        const dy = prev - curr
        if (Math.abs(dy) > 1) moved.push({ wrap, dy })
      }
      newTops[key] = curr
    })

    // Phase 2 (WRITE): apply the pre-animation transform to every moved row.
    for (const { wrap, dy } of moved) {
      wrap.style.transition = 'none'
      wrap.style.transform = `translateY(${dy}px)`
    }

    // One forced reflow for the whole batch so the transforms above are
    // registered before the transition is re-enabled below.
    if (moved.length) void container.offsetHeight

    for (const { wrap } of moved) {
      rafs.push(requestAnimationFrame(() => {
        wrap.style.transition = 'transform .35s cubic-bezier(.4,0,.2,1)'
        wrap.style.transform = ''
      }))
    }

    prevTops.current = newTops
    return () => {
      rafs.forEach(id => cancelAnimationFrame(id))
      container.removeEventListener('transitionend', onTransitionEnd)
    }
  }, [items, containerRef, attr])
}

export interface FlipLeaveRect {
  top: number
  left: number
  width: number
}

/**
 * Measures `rowEl` relative to `containerRef`'s current box, for rendering a
 * row that's about to leave the list as an absolutely-positioned overlay.
 * Pulling the leaving row out of flow this way — instead of shrinking it in
 * place — means the container's layout settles immediately, so the
 * `useFlipTransition` pass on the surviving rows sees one clean before/after
 * diff and glides them into place while the overlay fades out on top.
 */
export function captureFlipLeaveRect(
  containerRef: React.RefObject<HTMLElement | null>,
  rowEl: HTMLElement,
): FlipLeaveRect | null {
  const container = containerRef.current
  if (!container) return null
  const c = container.getBoundingClientRect()
  const r = rowEl.getBoundingClientRect()
  return { top: r.top - c.top, left: r.left - c.left, width: r.width }
}
