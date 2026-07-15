import { useRef, useLayoutEffect } from 'react'
import type React from 'react'

/**
 * FLIP reorder animation for lists keyed by data-occ-key.
 * When items change order (same count), each [data-occ-key] child
 * animates from its previous position to its new one.
 */
export function useFlipReorder<T>(
  containerRef: React.RefObject<HTMLElement | null>,
  items: T[],
) {
  const prevTops = useRef<Record<string, number>>({})
  const prevItemCount = useRef(items.length)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const wasReorder = items.length === prevItemCount.current
    prevItemCount.current = items.length

    const containerTop = container.getBoundingClientRect().top
    const wraps = container.querySelectorAll<HTMLElement>('[data-occ-key]')
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
      const key = wrap.getAttribute('data-occ-key')!
      const curr = wrap.getBoundingClientRect().top - containerTop

      if (wasReorder) {
        const prev = prevTops.current[key]
        if (prev !== undefined) {
          const dy = prev - curr
          if (Math.abs(dy) > 1) moved.push({ wrap, dy })
        }
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
  }, [items, containerRef])
}
