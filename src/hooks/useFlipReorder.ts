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

    wraps.forEach(wrap => {
      const key = wrap.getAttribute('data-occ-key')!
      const curr = wrap.getBoundingClientRect().top - containerTop

      if (wasReorder) {
        const prev = prevTops.current[key]
        if (prev !== undefined) {
          const dy = prev - curr
          if (Math.abs(dy) > 1) {
            wrap.style.transition = 'none'
            wrap.style.transform = `translateY(${dy}px)`
            void wrap.offsetHeight
            rafs.push(requestAnimationFrame(() => {
              wrap.style.transition = 'transform .35s cubic-bezier(.4,0,.2,1)'
              wrap.style.transform = ''
            }))
          }
        }
      }

      newTops[key] = curr
    })

    prevTops.current = newTops
    return () => {
      rafs.forEach(id => cancelAnimationFrame(id))
      container.removeEventListener('transitionend', onTransitionEnd)
    }
  }, [items, containerRef])
}
