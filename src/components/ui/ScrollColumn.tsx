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
  const ref = useRef<HTMLDivElement>(null)

  // Scroll to the item that matches `value` without animation (used on open)
  const scrollToValue = useCallback((v: T, behavior: ScrollBehavior = 'instant') => {
    const idx = items.indexOf(v)
    if (idx < 0 || !ref.current) return
    ref.current.scrollTo({ top: idx * ITEM_H, behavior })
  }, [items])

  // Sync scroll whenever value changes externally (e.g. parent sets initial value)
  useEffect(() => {
    scrollToValue(value)
  }, [value, scrollToValue])

  // Snap to nearest item after scrolling stops
  const handleScroll = useCallback(() => {
    if (!ref.current) return
    const idx = Math.round(ref.current.scrollTop / ITEM_H)
    const clamped = Math.max(0, Math.min(idx, items.length - 1))
    const next = items[clamped]
    if (next !== value) onChange(next)
  }, [items, value, onChange])

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
        onScroll={handleScroll}
        // padding-block lets first/last item scroll to the centre of the window
        style={{ paddingBlock: ITEM_H }}
        className={cn(
          'h-full overflow-y-scroll snap-y snap-mandatory',
          // hide native scrollbar
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
