import { useRef, useEffect, memo } from 'react'
import { Trash2 } from 'lucide-react'
import type { Occurrence } from '@/types'
import { OccurrenceCard } from '@/components'
import { useStore } from '@/store'
import { backlinksTo } from '@/fileOccurrence'

interface Props {
  occ: Occurrence
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
  showDate?: boolean
  /**
   * A per-render stamp from the caller (today's section only). Not read
   * directly — its only job is to appear in the props object, always
   * different from the previous render, so the default memo() below never
   * bails and OccurrenceCard always recomputes its wall-clock-dependent
   * occState() styling whenever this row's parent section rendered at all.
   */
  tick?: number
}

function OccurrenceRow({ occ, onOpen, onToggleDone, onSwipeDelete, showDate, tick }: Props) {
  void tick
  const roots    = useStore(s => s.roots)
  const listedOn = backlinksTo(occ.fileSlug, roots).map(slug => roots.get(slug)?.title ?? slug)

  const wrapRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<SVGSVGElement>(null)

  // Keep stable refs so the touch-listener closure (attached once, see below) never goes stale.
  const onSwipeDeleteRef = useRef(onSwipeDelete)
  useEffect(() => { onSwipeDeleteRef.current = onSwipeDelete }, [onSwipeDelete])
  const occRef = useRef(occ)
  useEffect(() => { occRef.current = occ }, [occ])

  // Swipe-to-delete: touchmove must call preventDefault() to block scroll while
  // the user is swiping horizontally. JSX onTouchMove cannot do that (passive by
  // default in modern browsers), so we use raw addEventListener with passive:false.
  useEffect(() => {
    // Guard: should never be null when mounted, but required for type safety.
    if (!wrapRef.current || !rowRef.current || !hintRef.current || !iconRef.current) return
    // Non-null assertions: narrowing doesn't carry into nested closure functions,
    // so we re-bind as non-nullable types here.
    const wrap  = wrapRef.current  as HTMLDivElement
    const row   = rowRef.current   as HTMLDivElement
    const hintL = hintRef.current  as HTMLDivElement
    const icon  = iconRef.current  as SVGSVGElement

    const THRESHOLD = 72
    const FULL_FRAC = 0.5
    let sx = 0, sy = 0, tracking = false, blocked = false

    function onTouchStart(e: TouchEvent) {
      sx = e.touches[0].clientX
      sy = e.touches[0].clientY
      tracking = false
      blocked = false
      row.style.animation = 'none'
      row.style.transition = 'none'
    }

    function onTouchMove(e: TouchEvent) {
      const dx = e.touches[0].clientX - sx
      const dy = e.touches[0].clientY - sy
      if (!tracking) {
        if (Math.abs(dy) > Math.abs(dx)) { blocked = true; return }
        if (dx > 0) { blocked = true; return }
        tracking = true
      }
      if (blocked) return
      e.preventDefault()
      const rowW = wrap.offsetWidth || 320
      const absDx = Math.abs(dx)
      const clamped = Math.min(Math.max(dx, -rowW), 0)
      row.style.setProperty('--swipe-x', `${clamped}px`)
      if (dx < -8) {
        const fullPx = rowW * FULL_FRAC
        const prog = Math.min(absDx / fullPx, 1)
        hintL.style.setProperty('--hint-filter', `saturate(${0.3 + prog * 0.7})`)
        hintL.style.setProperty('--hint-opacity', String(0.4 + prog * 0.6))
        hintL.classList.add('active')
        icon.style.setProperty('--icon-scale', String(0.7 + prog * 0.3))
      } else {
        hintL.classList.remove('active')
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (blocked || !tracking) {
        row.style.transition = ''
        row.style.setProperty('--swipe-x', '0px')
        hintL.classList.remove('active')
        return
      }
      const dx = e.changedTouches[0].clientX - sx
      const rowW = wrap.offsetWidth || 320
      const isFull = Math.abs(dx) / rowW >= FULL_FRAC
      hintL.classList.remove('active')
      icon.style.setProperty('--icon-scale', '1')
      if (dx <= -THRESHOLD && isFull) {
        // Phase 1: show toast immediately (before animation completes).
        // beginSwipeDelete() returns applyDelete — the function that actually
        // removes the item from the store once the exit animation is done.
        const applyDelete = onSwipeDeleteRef.current(occRef.current)
        // Kick off slide + collapse simultaneously.
        wrap.style.height = wrap.offsetHeight + 'px'
        wrap.style.overflow = 'hidden'
        void wrap.offsetHeight  // force reflow so the fixed height is registered
        row.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1)'
        row.style.setProperty('--swipe-x', `-${rowW}px`)
        wrap.style.transition = 'height .22s ease, opacity .22s ease'
        wrap.style.height = '0'
        wrap.style.opacity = '0'
        // Phase 2: remove from store after animation so React unmounts cleanly.
        setTimeout(() => applyDelete(), 230)
      } else {
        row.style.transition = 'transform .28s cubic-bezier(.4,0,.2,1)'
        row.style.setProperty('--swipe-x', '0px')
      }
    }

    row.addEventListener('touchstart', onTouchStart, { passive: true })
    row.addEventListener('touchmove', onTouchMove, { passive: false })
    row.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      row.removeEventListener('touchstart', onTouchStart)
      row.removeEventListener('touchmove', onTouchMove)
      row.removeEventListener('touchend', onTouchEnd)
    }
  }, []) // listeners are stable; callback accessed via ref

  return (
    <div
      className="relative overflow-hidden rounded-lg mx-2 mb-1.5"
      ref={wrapRef}
      data-occ-key={occ.id}
    >
      {/* Left swipe hint — display and opacity/filter driven by CSS (.swipe-hint/.active) */}
      <div
        ref={hintRef}
        className="swipe-hint absolute inset-0 items-center justify-end gap-[10px] px-5 pointer-events-none z-0 bg-destructive"
      >
        <Trash2
          ref={iconRef}
          size={18}
          strokeWidth={2.5}
          className="shrink-0 stroke-primary-foreground fill-none [transform:scale(var(--icon-scale,1))] transition-transform duration-150"
        />
        <span className="text-xs font-bold text-primary-foreground whitespace-nowrap">Delete</span>
      </div>

      {/* Main row — transform driven by CSS (.swipe-row) */}
      <div ref={rowRef} className="swipe-row relative z-[1] bg-background touch-pan-y select-none">
        <OccurrenceCard
          occ={occ}
          leadingIcon="checkbox"
          onOpen={() => onOpen(occ)}
          onToggleDone={() => onToggleDone(occ)}
          showDate={showDate}
          listedOn={listedOn}
          animate={false}
        />
      </div>
    </div>
  )
}

export default memo(OccurrenceRow)
