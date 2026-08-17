import { memo, useRef, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import type { Occurrence } from '@/types'
import { OccurrenceCard } from '@/components'
import { occState } from '@/occView'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { useEntryAccess } from '@/hooks'
import { DayBadge } from './DayBadge'

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
  /**
   * Set on a day's first occurrence row only (see agendaSections.ts's
   * dayRows) — the weekday/day-number badge that stands in for the old
   * per-day text header. Later rows on the same day pass null but still
   * reserve the gutter width, so their cards nest under the badge instead of
   * flush against the edge.
   */
  /**
   * Whether this row reserves gutter space for a day badge, and if so
   * whether it renders one. A required, explicit discriminant rather than an
   * optional `{ date, isToday } | null | undefined` — every caller states
   * its case by name instead of the component inferring "no gutter at all"
   * from a prop being merely absent:
   *   - 'day':    this row is a day's first occurrence — render the badge.
   *   - 'spacer': a later row on the same day (or an overdue row) — no
   *               badge, but still reserve the gutter so cards nest under
   *               the badge above instead of sliding left to fill the gap.
   *   - 'none':   this list has no day badges at all (backlog, notes) — no
   *               gutter is reserved, so cards sit flush against the edge.
   */
  badge: { kind: 'day'; date: Date; isToday: boolean } | { kind: 'spacer' } | { kind: 'none' }
}

// Memoized on purpose: now that `now` is an explicit, compared prop rather
// than an unread cache-buster, the default shallow-compare memo is correct —
// it only re-renders when `occ` or `now` actually changed, which is exactly
// when this row's rendered output could differ. Unrelated sibling changes in
// the same day leave `occ` reference-stable (see expansionCache.ts's overlay
// logic), so this row correctly skips re-rendering for those.
function AgendaRow({ occ, now, onOpen, onToggleDone, onSwipeDelete, showDate, badge }: Props) {
  const roots     = useStore(s => s.roots)
  const backlinks = useStore(s => s.backlinks)
  const listedOn  = (backlinks.get(occ.entryKey) ?? []).map(key => roots.get(key)?.title ?? key)

  // Mirrors OccurrenceCard's own `dimmed` (isDone || isPast) so this row's
  // outer wrapper — which hosts the elevation shadow OccurrenceCard's own
  // shadow can't show here (see the overflow-hidden comment below) — drops
  // it for done/past items too. Deliberately doesn't chase OccurrenceCard's
  // brief post-click optimistic-done state: the store commit that follows a
  // toggle click lands within the same tick, so the two are indistinguishable
  // in practice.
  const dimmed = !!occ.metadata.done || occState(occ, now) === 'event-past'

  // View-only vaults (an iCal subscription) have no source to write back to —
  // see hooks/useEntryAccess — so the swipe gesture is disabled there. The
  // Tutorial's sandbox vault is deliberately excluded from this: its mode is
  // 'sandbox', not 'view-only', so it keeps the gesture like a normal vault.
  const isViewOnly = useEntryAccess(occ).mode === 'view-only'

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
    if (isViewOnly) return
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
  }, [isViewOnly]) // listeners are stable; callback accessed via ref

  return (
    // items-start, and no min-height: this row must size to the card alone.
    // Anything that makes the row taller than the card — a min-height, or the
    // flex default of stretch letting a tall gutter grow the line — is
    // immediately visible, since the card's box carries the elevation shadow
    // and would paint that extra height as empty shadowed space below the
    // card. The badge is kept out of it entirely (see the gutter below).
    //
    // mt-3 on a badged row only: the extra breathing room between one day's
    // last card and the next day's badge that separates day groups the way
    // Google Calendar's agenda does. Rows within the same day (no badge)
    // keep the plain mb-1.5 card-to-card rhythm.
    <div className={cn('flex items-start gap-2 px-3.5 mb-1.5', badge.kind === 'day' && 'mt-3')}>
      {/* Gutter — an equal-width spacer on every row of a badged list
          (badge.kind !== 'none'; see the Props doc comment for the three
          cases) so cards line up in a column instead of flush against the
          edge. The badge (a day's first row only) is absolutely positioned
          inside it, top-0 so its own top
          edge lines up exactly with the card's (both are items-start flex
          siblings starting at this row's own top). It contributes no height
          here at all: it can neither stretch the card's shadowed box nor
          grow the row that the virtualizer measures to place everything
          below it.

          It may therefore overflow this row's bottom edge, which is fine at
          every size the agenda actually renders. DayBadge is a weekday line
          (10px font * inherited line-height 1.5 = 15px) + gap-0.5 (2px) + a
          w-7 circle (28px) = 45px, so it sits in y ∈ [0, 45]. The shortest
          possible row — a plain untimed card on its min-h-11 (44) floor —
          advances the next row to y = 50 via mb-1.5, and that next row is
          either a same-day sibling whose own gutter is empty, or the next
          day's row whose badge starts at 50. Either way there is nothing at
          y ∈ [45, 50] to collide with. */}
      {badge.kind !== 'none' && (
        <div className="w-9 shrink-0 relative">
          {badge.kind === 'day' && (
            <div className="absolute inset-x-0 top-0 flex justify-center">
              <DayBadge date={badge.date} isToday={badge.isToday} />
            </div>
          )}
        </div>
      )}
      {/* Two nested boxes: the swipe reveal needs overflow-hidden (clips the
          delete panel to the row's rounded corners and the horizontal slide),
          but that same overflow-hidden clips any box-shadow on the card inside
          it since the card fills this box exactly. So the shadow lives on this
          outer, unclipped box instead, wrapping the actual clip boundary. */}
      <div className={cn('relative rounded-lg flex-1 min-w-0', !dimmed && 'shadow-(--shadow-card)')} data-occ-key={occ.id}>
        <div
          className="relative overflow-hidden rounded-lg"
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
    </div>
  )
}

export default memo(AgendaRow)
