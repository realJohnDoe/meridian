import { memo, useRef, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import type { Occurrence } from '@/types'
import { OccurrenceCard } from '@/components'
import { occState } from '@/occView'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'

interface Props {
  occ: Occurrence
  /**
   * Current time, forwarded to OccurrenceCard so occState() can be a pure
   * function of (occ, now) instead of reading the wall clock itself. Passed
   * down from AgendaView, refreshed once a minute for today's section only —
   * omit for sections whose styling can't change from the clock alone (past/
   * future days, overdue tasks).
   */
  now?: Date
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
  showDate?: boolean
}

// Memoized on purpose: now that `now` is an explicit, compared prop rather
// than an unread cache-buster, the default shallow-compare memo is correct —
// it only re-renders when `occ` or `now` actually changed, which is exactly
// when this row's rendered output could differ. Unrelated sibling changes in
// the same day leave `occ` reference-stable (see expansionCache.ts's overlay
// logic), so this row correctly skips re-rendering for those.
function OccurrenceRow({ occ, now, onOpen, onToggleDone, onSwipeDelete, showDate }: Props) {
  const roots     = useStore(s => s.roots)
  const backlinks = useStore(s => s.backlinks)
  const listedOn  = (backlinks.get(occ.fileSlug) ?? []).map(slug => roots.get(slug)?.title ?? slug)

  // Mirrors OccurrenceCard's own `dimmed` (isDone || isPast) so this row's
  // outer wrapper — which hosts the elevation shadow OccurrenceCard's own
  // shadow can't show here (see the overflow-hidden comment below) — drops
  // it for done/past items too. Deliberately doesn't chase OccurrenceCard's
  // brief post-click optimistic-done state: the store commit that follows a
  // toggle click lands within the same tick, so the two are indistinguishable
  // in practice.
  const dimmed = !!occ.metadata.done || occState(occ, now) === 'event-past'

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
    const wrap  = wrapRef.current
    const row   = rowRef.current
    const hintL = hintRef.current
    const icon  = iconRef.current

    const THRESHOLD = 72
    const FULL_FRAC = 0.5
    let sx = 0, sy = 0, tracking = false, blocked = false
    let deleteTimeout: ReturnType<typeof setTimeout> | undefined

    function onTouchStart(e: TouchEvent) {
      const t = e.touches[0]!  // a touch event always carries at least one touch
      sx = t.clientX
      sy = t.clientY
      tracking = false
      blocked = false
      row.style.animation = 'none'
      row.style.transition = 'none'
    }

    function onTouchMove(e: TouchEvent) {
      const t = e.touches[0]!
      const dx = t.clientX - sx
      const dy = t.clientY - sy
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
      const dx = e.changedTouches[0]!.clientX - sx
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
        deleteTimeout = setTimeout(() => applyDelete(), 230)
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
      clearTimeout(deleteTimeout)
    }
  }, []) // listeners are stable; callback accessed via ref

  return (
    // Two nested boxes: the swipe reveal needs overflow-hidden (clips the
    // delete panel to the row's rounded corners and the horizontal slide),
    // but that same overflow-hidden clips any box-shadow on the card inside
    // it since the card fills this box exactly. So the shadow lives on this
    // outer, unclipped box instead, wrapping the actual clip boundary.
    <div className={cn('relative rounded-[var(--radius-calendar)] mx-3.5 mb-1.5', !dimmed && 'shadow-(--shadow-card)')} data-occ-key={occ.id}>
      <div
        className="relative overflow-hidden rounded-[var(--radius-calendar)]"
        ref={wrapRef}
      >
        {/* Left swipe hint — display and opacity/filter driven by CSS (.swipe-hint/.active) */}
        <div
          ref={hintRef}
          className="swipe-hint absolute inset-0 items-center justify-end gap-2.5 px-5 pointer-events-none z-0 bg-destructive"
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
        <div ref={rowRef} className="swipe-row relative z-10 bg-background touch-pan-y select-none">
          <OccurrenceCard
            occ={occ}
            now={now}
            leadingIcon="checkbox"
            onOpen={() => onOpen(occ)}
            onToggleDone={() => onToggleDone(occ)}
            showDate={showDate}
            listedOn={listedOn}
            animate={false}
          />
        </div>
      </div>
    </div>
  )
}

export default memo(OccurrenceRow)
