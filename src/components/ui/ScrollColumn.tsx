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
  const ref        = useRef<HTMLDivElement>(null)
  const touching   = useRef(false)
  const timer      = useRef<ReturnType<typeof setTimeout>>()

  // Keep stable refs so commitScroll never goes stale
  const itemsRef   = useRef(items)
  const onChangeRef = useRef(onChange)
  useEffect(() => { itemsRef.current   = items   }, [items])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Read current scroll position and fire onChange with the snapped item
  const commitScroll = useCallback(() => {
    if (!ref.current) return
    const idx     = Math.round(ref.current.scrollTop / ITEM_H)
    const clamped = Math.max(0, Math.min(idx, itemsRef.current.length - 1))
    onChangeRef.current(itemsRef.current[clamped])
  }, [])

  // Scroll to a specific item
  const scrollToValue = useCallback((v: T, behavior: ScrollBehavior = 'instant') => {
    const idx = items.indexOf(v)
    if (idx < 0 || !ref.current) return
    ref.current.scrollTo({ top: idx * ITEM_H, behavior })
  }, [items])

  // Sync scroll position when value changes externally (e.g. on open)
  useEffect(() => {
    scrollToValue(value)
  }, [value, scrollToValue])

  // ── Touch: commit only after finger lifts + snap settles ─────────────────
  const handleTouchStart = useCallback(() => {
    touching.current = true
    clearTimeout(timer.current)
  }, [])

  const handleTouchEnd = useCallback(() => {
    touching.current = false
    // Math.round(scrollTop / ITEM_H) predicts the snap destination immediately —
    // same rounding CSS snap-to-nearest uses — so no delay needed.
    commitScroll()
  }, [commitScroll])

  // ── Mouse / trackpad: debounce ────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    if (touching.current) return   // touch path handles it on finger-up
    clearTimeout(timer.current)
    timer.current = setTimeout(commitScroll, 150)
  }, [commitScroll])

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
          'h-full overflow-y-scroll snap-y snap-mandatory',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {items.map((item, i) => (
          <div
            key={i}
            className={cn(
              'h-11 snap-center flex items-center justify-center',
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
