import { memo } from 'react'
import type { Occurrence } from '@/types'
import { OccurrenceCard } from '@/components'
import { occState } from '@/occView'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { useEntryAccess } from '@/hooks'
import { DayBadge } from './DayBadge'
import SwipeToDeleteRow from './SwipeToDeleteRow'

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
          outer, unclipped box instead, wrapping the actual clip boundary
          (SwipeToDeleteRow owns the inner, clipped one). */}
      <div className={cn('relative rounded-lg flex-1 min-w-0', !dimmed && 'shadow-(--shadow-card)')} data-occ-key={occ.id}>
        <SwipeToDeleteRow occ={occ} onSwipeDelete={onSwipeDelete} disabled={isViewOnly}>
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
        </SwipeToDeleteRow>
      </div>
    </div>
  )
}

export default memo(AgendaRow)
