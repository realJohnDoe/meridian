import { useEffect, useLayoutEffect, useMemo, useRef, useCallback, memo } from 'react'
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

// How long the scroller has to be quiet before we consider it settled.
const SETTLE_MS = 120

// How far a single fling may travel before it runs out of strip. The list is
// repeated enough times to cover this in both directions from the middle, so
// momentum rolls through the wrap boundary without ever meeting a scroll
// limit. A strip only as long as the list itself dead-ends one row past the
// end — which is what used to stop a flick dead the moment the hour rolled.
const RUNWAY_PX = 2000

// Fallback for a smooth scroll that never lands exactly on its target.
const ANIM_MS = 500

const mod = (n: number, m: number) => ((n % m) + m) % m

// Enough whole repeats on each side of the middle to cover the runway, plus
// the middle itself — always an odd count, so `home` is genuinely centred.
function geometry(len: number) {
  const periods = Math.ceil(RUNWAY_PX / (len * ITEM_H)) * 2 + 1
  return { total: periods * len, home: Math.floor(periods / 2) * len }
}

const rowClass =
  'w-full h-10 flex items-center justify-center snap-center font-mono text-sm select-none cursor-pointer shrink-0'

// Rows are memoised and clicks are delegated to the scroller, so a value
// change re-renders only the few rows whose selected state actually flipped
// rather than all ~300 in the strip.
const Row = memo(function Row(
  { n, text, selected, canonical }: { n: number; text: string; selected: boolean; canonical: boolean },
) {
  const className = cn(rowClass, selected ? 'text-foreground font-semibold' : 'text-muted-foreground')
  // Only the middle period is exposed to assistive tech, so the listbox reads
  // as one clean set of options rather than the strip's many copies.
  return canonical ? (
    <button type="button" role="option" aria-selected={selected} data-n={n} tabIndex={-1} className={className}>
      {text}
    </button>
  ) : (
    <div aria-hidden="true" data-n={n} className={className}>{text}</div>
  )
})

interface ScrollColumnProps {
  items: number[]
  value: number
  fmt: (n: number) => string
  // `carry` is how many times the column rolled past the end of the list to
  // get here: +1 forward, -1 backward, and more when one fling genuinely
  // spins through several laps. Callers that chain columns (minutes carrying
  // into hours) use it; a column with nothing above it just ignores it.
  onChange: (v: number, carry: number) => void
  label: string
}

function ScrollColumn({ items, value, fmt, onChange, label }: ScrollColumnProps) {
  const ref = useRef<HTMLDivElement>(null)
  const len = items.length
  const { total, home } = useMemo(() => geometry(len), [len])

  // Which row of the strip we are on. Carries come from how many period
  // boundaries the position crosses between events, so genuine laps count
  // while our own programmatic writes — which claim this ref before touching
  // scrollTop — cross none and stay silent.
  const posRef = useRef<number | null>(null)
  const animRef = useRef<number | null>(null)   // target of an in-flight smooth scroll
  const animTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const settleRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // True while a finger is still on the wheel. A touch held still produces no
  // scroll events, so without this the quiet-scroll timer alone would snap the
  // wheel out from under a finger that hasn't lifted yet.
  //
  // Tracked with *touch* events, never pointer events: the spec has the browser
  // fire `pointercancel` as soon as a pointer starts panning the page, so a
  // drag that scrolls this column abandons its pointer stream mid-gesture and
  // never sends `pointerup` at all. Touch events keep firing through the scroll
  // and always deliver `touchend` to the element the gesture started on.
  const touchHoldRef = useRef(false)

  // Kept current so `settle` can stay stable while still seeing the latest
  // props when it finally fires from a timer.
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  // Lets `settle` re-arm itself without naming itself before it exists.
  const settleFnRef = useRef<() => void>(() => {})
  useLayoutEffect(() => { valueRef.current = value; onChangeRef.current = onChange })

  const settle = useCallback(() => {
    const node = ref.current
    if (!node) return
    if (animRef.current !== null || touchHoldRef.current) {
      // Our own animation is still in flight, or a finger is still holding
      // the wheel; look again once it is done. Re-arming rather than
      // returning matters: this is the only thing left running, so dropping
      // it here would leave the wheel wherever it lies.
      settleRef.current = setTimeout(() => settleFnRef.current(), SETTLE_MS)
      return
    }
    const k = Math.max(0, Math.min(Math.round(node.scrollTop / ITEM_H), total - 1))
    // Back to the middle period, so the next fling gets a full runway again.
    // A whole-period hop lands on an identical row, so it is invisible; the
    // same write squares up a column left resting between rows.
    const target = home + mod(k, len)
    posRef.current = target
    if (Math.abs(node.scrollTop - target * ITEM_H) > 0.5) node.scrollTop = target * ITEM_H

    // Whatever happened on the way here — an animation cut short, a drag
    // whose events were swallowed while one was running — the row now under
    // the highlight is the truth. Without this the two can disagree forever,
    // which is what left a column resting off its own bolded value.
    const landed = items[mod(k, len)]!
    if (landed !== valueRef.current) onChangeRef.current(landed, 0)
  }, [total, home, len, items])

  useLayoutEffect(() => { settleFnRef.current = settle }, [settle])

  // Both ways a finger can leave the wheel: lifted, or the gesture taken over
  // by the system. Kicks a settle pass off right away rather than waiting out
  // whatever quiet-scroll timer was last queued.
  const release = useCallback(() => {
    touchHoldRef.current = false
    clearTimeout(settleRef.current)
    settleRef.current = setTimeout(settle, SETTLE_MS)
  }, [settle])

  useEffect(() => () => {
    clearTimeout(settleRef.current)
    clearTimeout(animTimerRef.current)
  }, [])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const idx = items.indexOf(value)
    if (idx < 0) return
    const pos = posRef.current

    if (pos === null) {
      // First paint: land on the middle period, no animation.
      posRef.current = home + idx
      el.scrollTop = (home + idx) * ITEM_H
      return
    }
    // Already showing this value — our own scroll coming home. Writing
    // scrollTop here would fight the in-flight momentum.
    if (mod(pos, len) === idx) return

    // Someone else moved us: the minute wheel carrying the hour, an arrow
    // key, a tap on a row. Roll to the *nearest* row holding the new value —
    // for a carry that is exactly one row away — and animate it, so the hour
    // turns over in step with the minute wheel the way a geared watch does.
    const step = mod(idx - mod(pos, len) + len / 2, len) - len / 2
    const target = Math.max(0, Math.min(pos + step, total - 1))
    posRef.current = target
    animRef.current = target * ITEM_H
    clearTimeout(animTimerRef.current)
    animTimerRef.current = setTimeout(() => {
      // The scroll never landed on its target — interrupted, or a browser
      // that quietly declined to animate. Hand back to the settle pass so
      // the wheel is squared up and reconciled rather than left adrift.
      animRef.current = null
      clearTimeout(settleRef.current)
      settleRef.current = setTimeout(settle, SETTLE_MS)
    }, ANIM_MS)
    if (typeof el.scrollTo === 'function') el.scrollTo({ top: target * ITEM_H, behavior: 'smooth' })
    else el.scrollTop = target * ITEM_H
  }, [value, items, len, home, total, settle])

  const handleScroll = useCallback(() => {
    const el = ref.current
    if (!el) return
    const k = Math.max(0, Math.min(Math.round(el.scrollTop / ITEM_H), total - 1))

    // Unconditionally, so that however this scroll ends — landed, swallowed,
    // interrupted — a pass is always pending to square the wheel up. Leaving
    // it out of the animation branch below is what stranded a column between
    // rows with nothing left running to fix it.
    clearTimeout(settleRef.current)
    settleRef.current = setTimeout(settle, SETTLE_MS)

    // Our own animation is running: track where it has got to, never emit.
    if (animRef.current !== null) {
      posRef.current = k
      if (Math.abs(el.scrollTop - animRef.current) < 0.5) {
        animRef.current = null
        clearTimeout(animTimerRef.current)
      }
      return
    }

    const prev = posRef.current
    if (prev === null || k === prev) return
    posRef.current = k
    // Every period boundary between the two positions is one roll past the
    // end of the list. No boundary row to land on and no latch to arm, so
    // momentum is never interrupted — and a fling that really does spin
    // several laps carries several hours.
    onChange(items[mod(k, len)]!, Math.floor(k / len) - Math.floor(prev / len))
  }, [items, onChange, total, len, settle])

  const rows = useMemo(
    () => Array.from({ length: total }, (_, k) => ({
      k,
      n: items[mod(k, len)]!,
      canonical: k >= home && k < home + len,
    })),
    [total, items, len, home],
  )

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
        // Let the user grab the wheel back out of an in-flight animation.
        // Wheel and touch both count: a trackpad scroll fires no pointerdown,
        // so without `onWheel` those scrolls were swallowed by the guard and
        // the column drifted away from the value it was showing.
        onPointerDown={() => { animRef.current = null }}
        onWheel={() => { animRef.current = null }}
        // A finger additionally holds off the settle pass until it lifts —
        // see `touchHoldRef` for why this can't ride on the pointer events.
        onTouchStart={() => { animRef.current = null; touchHoldRef.current = true }}
        onTouchEnd={release}
        onTouchCancel={release}
        onClick={e => {
          const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-n]')
          if (hit) onChange(Number(hit.dataset.n), 0)
        }}
        onKeyDown={e => {
          const idx = items.indexOf(value)
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const next = idx + (e.key === 'ArrowDown' ? 1 : -1)
            onChange(items[mod(next, len)]!, next >= len ? 1 : next < 0 ? -1 : 0)
          }
        }}
        style={{ scrollbarWidth: 'none' }}
      >
        <div className="h-10 shrink-0" /> {/* pad, so the first row can reach the centre */}
        {rows.map(r => (
          <Row key={r.k} n={r.n} text={fmt(r.n)} selected={r.n === value} canonical={r.canonical} />
        ))}
        <div className="h-10 shrink-0" /> {/* pad, so the last row can reach the centre */}
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
    (nm: number, carry: number) => emit(mod(latestRef.current.h + carry, 24), nm),
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
