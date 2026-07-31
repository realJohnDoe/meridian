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
// got interrupted (a tap landing mid-fling on iOS) and left it between rows,
// and it's when a column parked on a wrap ghost hops to the real row.
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

  // Content layout, top to bottom:
  //   [pad(-2), ghost(-1), items[0..N-1], ghost(0), pad(1)]
  // The two ghosts preview the opposite end of the list so the wheel can be
  // scrolled one row past either end instead of dead-ending — that overshoot
  // is what a wrap is. The pads beyond them supply the scroll room a ghost
  // needs to reach the centered/highlighted row at all, and they show the
  // *next* value round so the settle-time hop from ghost to real row is
  // pixel-identical rather than a visible flicker.
  //
  // Positions below are "ext" indices: scrollTop = extIdx * ITEM_H, where
  // extIdx = realIdx + 1. So ext 0 centers ghost(-1), ext 1..N center the
  // real rows, and ext N+1 centers ghost(0).
  const extLen = items.length + 2
  const len = items.length
  const at = (i: number) => items[((i % len) + len) % len]!

  // The ext index this column currently represents. Every programmatic
  // scrollTop write sets this first, so the scroll event that write provokes
  // sees `raw === emittedRef.current` and returns instead of re-emitting.
  // Deduping against this ref rather than against `value` is deliberate:
  // `value` is a render-time snapshot, and scroll events routinely fire
  // several times before React commits the next render, so a stale `value`
  // would let our own echo through — which is exactly how a carry used to be
  // overwritten a millisecond after it landed.
  const emittedRef = useRef<number | null>(null)

  // Latched while parked on a ghost row, so one boundary crossing emits one
  // carry no matter how many scroll events the fling fires there.
  const onGhostRef = useRef(false)
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const idx = items.indexOf(value)
    if (idx < 0) return
    const extIdx = idx + 1
    // Already where this value belongs — either our own scroll coming home,
    // or a column parked on the ghost that renders this same value. Writing
    // scrollTop here would fight the in-flight momentum/snap animation.
    if (extIdx === emittedRef.current) return
    emittedRef.current = extIdx
    el.scrollTop = extIdx * ITEM_H
  }, [value, items])

  useEffect(() => () => clearTimeout(settleRef.current), [])

  const handleScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const raw = Math.max(0, Math.min(Math.round(el.scrollTop / ITEM_H), extLen - 1))

    clearTimeout(settleRef.current)
    settleRef.current = setTimeout(() => {
      const node = ref.current
      if (!node) return
      const idx = Math.max(0, Math.min(Math.round(node.scrollTop / ITEM_H), extLen - 1))

      if (idx === 0 || idx === extLen - 1) {
        // Parked on a ghost with the fling over: hop to the real row showing
        // the same number. Deferring this to settle rather than doing it the
        // instant the boundary is touched is what keeps one gesture to one
        // carry — recentring mid-fling hands the momentum animation fresh
        // runway to hit the boundary again, and it would carry once per lap.
        // An instant write, not `smooth`: the glyphs are identical, so the
        // jump is invisible, whereas a smooth scroll visibly slides the list.
        const real = idx === 0 ? items.length : 1
        emittedRef.current = real
        onGhostRef.current = false
        node.scrollTop = real * ITEM_H
        return
      }

      const target = idx * ITEM_H
      if (Math.abs(node.scrollTop - target) > 0.5) node.scrollTo({ top: target, behavior: 'smooth' })
    }, SETTLE_MS)

    if (raw === 0 || raw === extLen - 1) {
      if (onGhostRef.current) return
      onGhostRef.current = true
      const carry = raw === 0 ? -1 : 1
      // The real row this ghost stands in for; claiming it now keeps the
      // layout effect from yanking the wheel off the ghost mid-fling when
      // the carried value arrives back as a prop.
      const real = raw === 0 ? items.length : 1
      emittedRef.current = real
      onChange(items[real - 1]!, carry)
      return
    }

    onGhostRef.current = false
    if (raw === emittedRef.current) return
    emittedRef.current = raw
    onChange(items[raw - 1]!, 0)
  }, [items, onChange, extLen])

  const ghostClass =
    'h-10 shrink-0 flex items-center justify-center font-mono text-sm text-muted-foreground/40 select-none'

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
            onChange(at(next), carry)
          }
        }}
        style={{ scrollbarWidth: 'none' }}
      >
        {/* pad — never centered, only ever seen as the row beyond a ghost */}
        <div aria-hidden="true" className={ghostClass}>{fmt(at(-2))}</div>
        <div aria-hidden="true" className={cn(ghostClass, 'snap-center')}>{fmt(at(-1))}</div>
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
        <div aria-hidden="true" className={cn(ghostClass, 'snap-center')}>{fmt(at(0))}</div>
        <div aria-hidden="true" className={ghostClass}>{fmt(at(1))}</div>
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

  // A minute carry has to combine with the hour as it stands *now*, not as it
  // stood when this render's callback was created. Scroll events outpace
  // React's render loop, so a carry that read the render-captured `h` would
  // compute its new hour from a value the previous emit had already replaced
  // — and quietly undo itself. Every emit writes here first, so the next one
  // always sees the result of the last.
  const latestRef = useRef({ h, m })
  useLayoutEffect(() => { latestRef.current = { h, m } }, [h, m])

  const emit = useCallback((nh: number, nm: number) => {
    latestRef.current = { h: nh, m: nm }
    onChange(`${pad2(nh)}:${pad2(nm)}`)
  }, [onChange])

  const onHour = useCallback((nh: number) => emit(nh, latestRef.current.m), [emit])
  const onMinute = useCallback(
    (nm: number, carry: number) => emit((latestRef.current.h + carry + 24) % 24, nm),
    [emit],
  )

  return (
    <div className="flex items-center gap-1">
      <ScrollColumn items={HOURS}   value={h} fmt={pad2} onChange={onHour}   label="Hour" />
      <span className="text-muted-foreground font-mono text-lg leading-none">:</span>
      <ScrollColumn items={MINUTES} value={m} fmt={pad2} onChange={onMinute} label="Minute" />
    </div>
  )
}
