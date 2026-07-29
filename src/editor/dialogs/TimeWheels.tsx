import { useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/cn'

// The column geometry is load-bearing and must stay consistent: the viewport is
// exactly three rows tall (h-30 = 120px), rows are one row (h-10), and the
// highlight sits on the middle row (top-10 h-10). Because the viewport is a
// whole number of rows, `snap-center` resolves to exactly `idx * ITEM_H` — the
// same offset the programmatic scroll writes and the same one the highlight is
// drawn at. A viewport height that isn't a multiple of ITEM_H shifts every snap
// point by half the remainder, which leaves the wheel permanently resting off
// its highlight.
const ITEM_H = 40 // px per visible row

// How long the scroller has to be quiet before we consider it settled. Snap
// normally lands it on a row by itself; this is the safety net for a snap that
// got interrupted (a tap landing mid-fling on iOS) and left it between rows.
const SETTLE_MS = 120

interface ScrollColumnProps {
  items: number[]
  value: number
  fmt: (n: number) => string
  // `carry` is nonzero when the change crossed the wrap boundary: +1 rolled
  // forward past the last row onto the first, -1 rolled backward past the
  // first row onto the last. Callers that chain columns (minutes carrying
  // into hours) use it; a column with nothing above it just ignores it.
  onChange: (v: number, carry: number) => void
  label: string
}

function ScrollColumn({ items, value, fmt, onChange, label }: ScrollColumnProps) {
  const ref = useRef<HTMLDivElement>(null)
  // The old spacer rows above/below the real items are replaced by a single
  // "ghost" row on each side previewing the opposite end of the list (23
  // above 00, 00 below 23, ...). Scrolling onto a ghost is what makes the
  // wheel feel periodic: handleScroll detects it and instantly re-centers the
  // scroll position on the real row at the far end, so there's always a fresh
  // ghost to scroll onto if the gesture continues in the same direction.
  // Row indices below are in this extended (ghost + items + ghost) space;
  // extIdx = realIdx + 1.
  const extLen = items.length + 2

  // ext index this column last reported upward (including recenters after a
  // wrap). `value` echoing that index back is our own scroll coming home, not
  // an external change — writing scrollTop for it would fight the in-flight
  // momentum/snap animation and strand the wheel between rows.
  const emitted = useRef<number | null>(null)
  const settleId = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const idx = items.indexOf(value)
    if (idx < 0) return
    const extIdx = idx + 1
    if (extIdx === emitted.current) return
    el.scrollTop = extIdx * ITEM_H
  }, [value, items])

  useEffect(() => () => clearTimeout(settleId.current), [])

  const handleScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const raw = Math.max(0, Math.min(Math.round(el.scrollTop / ITEM_H), extLen - 1))

    // Landing on a ghost row: wrap to the real row at the opposite end and
    // jump the scroll position there instantly (same content, so the jump is
    // invisible) instead of letting the wheel dead-end at the boundary.
    let carry = 0
    let target = raw
    if (raw === 0) {
      carry = -1
      target = items.length
    } else if (raw === extLen - 1) {
      carry = 1
      target = 1
    }

    if (carry !== 0) {
      el.scrollTop = target * ITEM_H
      emitted.current = target
    }

    clearTimeout(settleId.current)
    settleId.current = setTimeout(() => {
      const node = ref.current
      if (!node) return
      const idx = Math.max(0, Math.min(Math.round(node.scrollTop / ITEM_H), extLen - 1))
      const clamped = Math.max(1, Math.min(idx, extLen - 2))
      const settleTarget = clamped * ITEM_H
      if (Math.abs(node.scrollTop - settleTarget) > 0.5) node.scrollTo({ top: settleTarget, behavior: 'smooth' })
    }, SETTLE_MS)

    const newValue = items[target - 1]!
    if (carry === 0) {
      if (newValue === value) return
      emitted.current = target
    }
    onChange(newValue, carry)
  }, [items, value, onChange, extLen])

  return (
    <div className="relative w-12 h-30">
      {/* selection highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-10 h-10 rounded-md bg-primary/10 z-10" />
      {/* fade top / bottom */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-background to-transparent z-20" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent z-20" />
      <div
        ref={ref}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        className="h-full overflow-y-scroll snap-y snap-mandatory [&::-webkit-scrollbar]:hidden focus-visible:outline-none"
        onScroll={handleScroll}
        onKeyDown={e => {
          const idx = items.indexOf(value)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const delta = e.key === 'ArrowDown' ? 1 : -1
            const next = idx + delta
            const carry = next >= items.length ? 1 : next < 0 ? -1 : 0
            const newIdx = (next + items.length) % items.length
            onChange(items[newIdx]!, carry)
          }
        }}
        style={{ scrollbarWidth: 'none' }}
      >
        <div
          aria-hidden="true"
          className="h-10 shrink-0 flex items-center justify-center snap-center font-mono text-sm text-muted-foreground/40 select-none"
        >
          {fmt(items[items.length - 1]!)}
        </div>
        {items.map(n => (
          <button
            key={n}
            type="button"
            role="option"
            aria-selected={n === value}
            tabIndex={-1}
            className={cn(
              'w-full h-10 flex items-center justify-center snap-center font-mono text-sm select-none cursor-pointer shrink-0',
              n === value ? 'text-foreground font-semibold' : 'text-muted-foreground',
            )}
            onClick={() => onChange(n, 0)}
          >
            {fmt(n)}
          </button>
        ))}
        <div
          aria-hidden="true"
          className="h-10 shrink-0 flex items-center justify-center snap-center font-mono text-sm text-muted-foreground/40 select-none"
        >
          {fmt(items[0]!)}
        </div>
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
  const h = parts ? parseInt(parts[1]!, 10) : 9
  const rawM = parts ? parseInt(parts[2]!, 10) : 0
  const m = Math.round(rawM / MINUTE_STEP) * MINUTE_STEP % 60

  return (
    <div className="flex items-center gap-1">
      <ScrollColumn
        items={HOURS}
        value={h}
        fmt={pad2}
        onChange={nh => onChange(`${pad2(nh)}:${pad2(m)}`)}
        label="Hour"
      />
      <span className="text-muted-foreground font-mono text-lg leading-none">:</span>
      <ScrollColumn
        items={MINUTES}
        value={m}
        fmt={pad2}
        onChange={(nm, carry) => onChange(`${pad2((h + carry + 24) % 24)}:${pad2(nm)}`)}
        label="Minute"
      />
    </div>
  )
}
