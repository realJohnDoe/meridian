import { useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

// ── Constants ────────────────────────────────────────────────────────────────
const ITEM_H = 44 // px — h-11

// ── Types ────────────────────────────────────────────────────────────────────
interface Props<T extends string | number> {
  items: T[]
  value: T
  onChange: (v: T) => void
  /** Optional label formatter — e.g. pad "9" to "09" */
  format?: (v: T) => string
  className?: string
}

// ── Component ────────────────────────────────────────────────────────────────
export function ScrollColumn<T extends string | number>({
  items, value, onChange, format, className,
}: Props<T>) {
  const ref      = useRef<HTMLDivElement>(null)
  const touching = useRef(false)
  const snapping = useRef(false)   // true while our own smooth-scroll animation runs
  const timer    = useRef<ReturnType<typeof setTimeout>>()

  // Stable refs so callbacks never go stale
  const itemsRef    = useRef(items)
  const onChangeRef = useRef(onChange)
  useEffect(() => { itemsRef.current    = items   }, [items])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // ── Snap to a specific index ──────────────────────────────────────────────
  const snapToIndex = useCallback((idx: number, behavior: ScrollBehavior = 'smooth') => {
    if (!ref.current) return
    snapping.current = true
    ref.current.scrollTo({ top: idx * ITEM_H, behavior })
    clearTimeout(timer.current)
    // Clear flag after animation — 'instant' resolves immediately, 'smooth' ~300 ms
    timer.current = setTimeout(() => { snapping.current = false }, behavior === 'instant' ? 0 : 350)
  }, [])

  const scrollToValue = useCallback((v: T, behavior: ScrollBehavior = 'instant') => {
    const idx = itemsRef.current.indexOf(v)
    if (idx >= 0) snapToIndex(idx, behavior)
  }, [snapToIndex])

  // External value changes (e.g. dialog opens): sync scroll position
  // Guard: don't interrupt an animation we started ourselves
  useEffect(() => {
    if (snapping.current) return
    scrollToValue(value)
  }, [value, scrollToValue])

  // ── Touch: snap to nearest on finger lift ────────────────────────────────
  const handleTouchStart = useCallback(() => {
    touching.current = true
    clearTimeout(timer.current)
    snapping.current = false
  }, [])

  const handleTouchEnd = useCallback(() => {
    touching.current = false
    if (!ref.current) return
    const idx     = Math.round(ref.current.scrollTop / ITEM_H)
    const clamped = Math.max(0, Math.min(idx, itemsRef.current.length - 1))
    snapToIndex(clamped, 'smooth')          // animate to snap point
    onChangeRef.current(itemsRef.current[clamped])  // commit value immediately
  }, [snapToIndex])

  // ── Mouse / trackpad: debounce + snap ────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (touching.current || snapping.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (!ref.current) return
      const idx     = Math.round(ref.current.scrollTop / ITEM_H)
      const clamped = Math.max(0, Math.min(idx, itemsRef.current.length - 1))
      snapToIndex(clamped, 'smooth')
      onChangeRef.current(itemsRef.current[clamped])
    }, 150)
  }, [snapToIndex])

  return (
    <div className={cn('relative h-[132px] overflow-hidden', className)}>
      {/* top fade */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-11 z-10 bg-gradient-to-b from-background to-transparent" />
      {/* selection highlight band */}
      <div className="pointer-events-none absolute inset-x-0 top-[44px] h-11 rounded-lg bg-white/5 border border-white/10 z-10" />
      {/* bottom fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 z-10 bg-gradient-to-t from-background to-transparent" />

      <div
        ref={ref}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onScroll={handleScroll}
        style={{ paddingBlock: ITEM_H }}
        className={cn(
          'h-full overflow-y-scroll',
          // No CSS snap — we handle all snapping in JS for full control
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {items.map((item, i) => (
          <div
            key={i}
            className={cn(
              'h-11 flex items-center justify-center',
              'text-xl font-mono select-none cursor-pointer',
              item === value ? 'text-foreground' : 'text-muted-foreground',
            )}
            onClick={() => { onChange(item); scrollToValue(item, 'smooth') }}
          >
            {format ? format(item) : String(item)}
          </div>
        ))}
      </div>
    </div>
  )
}
