import { useLayoutEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/cn'

const ITEM_H = 40 // px per visible row

interface ScrollColumnProps {
  items: number[]
  value: number
  fmt: (n: number) => string
  onChange: (v: number) => void
}

function ScrollColumn({ items, value, fmt, onChange }: ScrollColumnProps) {
  const ref    = useRef<HTMLDivElement>(null)
  const syncing = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const idx = items.indexOf(value)
    if (idx < 0) return
    syncing.current = true
    el.scrollTop = idx * ITEM_H
    requestAnimationFrame(() => { syncing.current = false })
  }, [value, items])

  const handleScroll = useCallback(() => {
    if (syncing.current) return
    const el = ref.current
    if (!el) return
    const idx = Math.round(el.scrollTop / ITEM_H)
    const v = items[Math.max(0, Math.min(idx, items.length - 1))]
    if (v !== value) onChange(v)
  }, [items, value, onChange])

  return (
    <div className="relative w-12 h-32">
      {/* selection highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-10 h-10 rounded-md bg-primary/10 z-10" />
      {/* fade top / bottom */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-background to-transparent z-20" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent z-20" />
      <div
        ref={ref}
        className="h-full overflow-y-scroll snap-y snap-mandatory [&::-webkit-scrollbar]:hidden"
        onScroll={handleScroll}
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="h-10 shrink-0" /> {/* top spacer */}
        {items.map(n => (
          <div
            key={n}
            className={cn(
              'h-10 flex items-center justify-center snap-center font-mono text-sm select-none cursor-pointer shrink-0',
              n === value ? 'text-foreground font-semibold' : 'text-muted-foreground',
            )}
            onClick={() => onChange(n)}
          >
            {fmt(n)}
          </div>
        ))}
        <div className="h-10 shrink-0" /> {/* bottom spacer */}
      </div>
    </div>
  )
}

const MINUTE_STEP = 5
const HOURS   = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP)
const pad2    = (n: number) => String(n).padStart(2, '0')

interface Props {
  value: string    // HH:MM
  onChange: (hhmm: string) => void
}

export default function TimeWheels({ value, onChange }: Props) {
  const parts = value.match(/^(\d{1,2}):(\d{2})/)
  const h = parts ? parseInt(parts[1], 10) : 9
  const rawM = parts ? parseInt(parts[2], 10) : 0
  const m = Math.round(rawM / MINUTE_STEP) * MINUTE_STEP % 60

  return (
    <div className="flex items-center gap-1">
      <ScrollColumn items={HOURS}   value={h} fmt={pad2} onChange={nh => onChange(`${pad2(nh)}:${pad2(m)}`)} />
      <span className="text-muted-foreground font-mono text-lg leading-none">:</span>
      <ScrollColumn items={MINUTES} value={m} fmt={pad2} onChange={nm => onChange(`${pad2(h)}:${pad2(nm)}`)} />
    </div>
  )
}
