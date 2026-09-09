import { memo } from 'react'
import type { Occurrence } from '@/types'
import { OccurrenceCard } from '@/components'
import { useStore } from '@/store'
import { useEntryAccess } from '@/hooks'
import { fmtShort } from '@/format'
import SwipeToDeleteRow from './SwipeToDeleteRow'

interface Props {
  /** The group's oldest overdue occurrence — see overduePool.ts's OverdueGroup. */
  occ: Occurrence
  /** How many overdue occurrences the group pools; 1 renders no count chip. */
  count: number
  /** The oldest overdue instant, for the count chip's tooltip. */
  oldest: Date
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

/**
 * One row of the grouped overdue section: a single unfinished series, shown as
 * its oldest outstanding occurrence.
 *
 * Deliberately *not* AgendaRow with a different prop. One behaviour differs in
 * kind rather than degree:
 *
 *   - **The gutter carries a count, not a day badge.** A group spans many days,
 *     so it has no single day to badge; the card's own date chip (`showDate`)
 *     says which day the representative is from, and the gutter — the same
 *     width, so cards stay in one column with the day rows above and below —
 *     says how many more there are behind it.
 *
 * Swipe-to-delete deletes the occurrence under the finger, same as the
 * checkbox: it means exactly what it shows (the count drops by one, and the
 * next-oldest becomes the representative), not "delete the whole series" — a
 * group only pools multiple occurrences for a recurring series, and deleting
 * one just excludes that date, same as swiping it away from its own day would.
 * The checkbox is kept alongside it: completing the oldest occurrence of an
 * overdue task is the single most likely thing to want to do from this row.
 * Tapping anywhere else opens that occurrence's entry; the rest of the group
 * is reachable by scrolling back to its own days.
 */
function AgendaOverdueGroupRow({ occ, count, oldest, onOpen, onToggleDone, onSwipeDelete }: Props) {
  const roots     = useStore(s => s.roots)
  const backlinks = useStore(s => s.backlinks)
  const listedOn  = (backlinks.get(occ.entryKey) ?? []).map(key => roots.get(key)?.title ?? key)

  // See AgendaRow's identical check: view-only vaults have no source to write
  // back to, so the swipe gesture is disabled there.
  const isViewOnly = useEntryAccess(occ).mode === 'view-only'

  return (
    // Mirrors AgendaRow's own outer box: items-start and no min-height, so the
    // row sizes to the card alone and the elevation shadow doesn't paint empty
    // space below it. No mt-3 — an overdue row never starts a new day.
    <div className="flex items-start gap-2 px-3.5 mb-1.5">
      <div className="w-9 shrink-0 relative">
        {count > 1 && (
          <div className="absolute inset-x-0 top-0 flex justify-center">
            <span
              className="rounded-full bg-warning/15 text-warning text-2xs font-bold tabular-nums px-1.5 py-0.5"
              title={`${count} overdue, oldest ${fmtShort(oldest)}`}
            >
              ×{count}
            </span>
          </div>
        )}
      </div>
      {/* See AgendaRow's identical wrapper: the shadow lives on this outer,
          unclipped box since SwipeToDeleteRow's own overflow-hidden would
          otherwise clip it. */}
      <div className="relative rounded-lg flex-1 min-w-0 shadow-(--shadow-card)" data-occ-key={occ.id}>
        <SwipeToDeleteRow occ={occ} onSwipeDelete={onSwipeDelete} disabled={isViewOnly}>
          <OccurrenceCard
            occ={occ}
            leadingIcon="checkbox"
            onOpen={() => onOpen(occ)}
            onToggleDone={() => onToggleDone(occ)}
            showDate
            listedOn={listedOn}
            animate={false}
          />
        </SwipeToDeleteRow>
      </div>
    </div>
  )
}

export default memo(AgendaOverdueGroupRow)
