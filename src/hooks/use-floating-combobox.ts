import { useEffect, useRef, useState } from 'react'
import { computeFloatingPlacement, type FloatingPlacement } from '@/lib/floatingPlacement'
import { findScrollParent } from '@/lib/scrollParent'
import { useVisibleViewport } from './use-visual-viewport'

export type FloatingComboboxPlacement = FloatingPlacement

// Anchors a combobox's input in place (it never moves) and floats the
// suggestion list independently: below the input when there's room, above it
// otherwise — e.g. when the on-screen keyboard eats the space below. When it
// flips above, we also nudge the nearest scroll container so the input lands
// just above the keyboard, maximizing room for the flipped list (matches the
// Obsidian wikilink-autocomplete layout this was modeled on).
export function useFloatingCombobox(open: boolean, onOpenChange: (open: boolean) => void) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const listRef   = useRef<HTMLDivElement>(null)
  const [rawPlacement, setPlacement] = useState<FloatingComboboxPlacement | null>(null)
  const scrolledRef = useRef(false)

  const visible = useVisibleViewport()

  useEffect(() => {
    if (!open) {
      scrolledRef.current = false
      return
    }

    function recompute() {
      const el = anchorRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const visibleTop    = visible.top
      const visibleBottom = visibleTop + visible.height
      const placement = computeFloatingPlacement(rect, {
        visibleTop,
        visibleBottom,
        innerWidth:  window.innerWidth,
        innerHeight: window.innerHeight,
      })
      setPlacement(placement)

      if (placement.side === 'top' && !scrolledRef.current) {
        scrolledRef.current = true
        const targetBottom = visibleBottom - 16
        const delta = rect.bottom - targetBottom
        if (Math.abs(delta) > 4) {
          findScrollParent(el)?.scrollBy({ top: delta, behavior: 'smooth' })
        }
      }
    }

    recompute()
    const ro = new ResizeObserver(recompute)
    ro.observe(anchorRef.current!)
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    const vv = window.visualViewport
    vv?.addEventListener('resize', recompute)
    vv?.addEventListener('scroll', recompute)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
      vv?.removeEventListener('resize', recompute)
      vv?.removeEventListener('scroll', recompute)
    }
  }, [open, visible])

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node
      if (anchorRef.current?.contains(target) || listRef.current?.contains(target)) return
      onOpenChange(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false) }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onOpenChange])

  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => {
      anchorRef.current?.querySelector('input')?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [open])

  return { anchorRef, listRef, placement: open ? rawPlacement : null }
}
