import { memo } from 'react'
import type { Occurrence } from '@/types'
import { OccurrenceCard } from '@/components'
import { useStore } from '@/store'
import { fmtShort } from '@/format'

interface Props {
  /** The group's oldest overdue occurrence — see overduePool.ts's OverdueGroup. */
  occ: Occurrence
  /** How many overdue occurrences the group pools; 1 renders no count chip. */
  count: number
  /** The oldest overdue instant, for the count chip's tooltip. */
  oldest: Date
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
}

/**
 * One row of the grouped overdue section: a single unfinished series, shown as
 * its oldest outstanding occurrence.
 *
 * Deliberately *not* AgendaRow with a different prop. Two behaviours differ in
 * kind rather than degree:
 *
 *   - **No swipe-to-delete.** The gesture deletes the occurrence under the
 *     finger, and here that occurrence stands for a whole series. A swipe that
 *     silently means something other than what it shows is worse than no swipe.
 *   - **The gutter carries a count, not a day badge.** A group spans many days,
 *     so it has no single day to badge; the card's own date chip (`showDate`)
 *     says which day the representative is from, and the gutter — the same
 *     width, so cards stay in one column with the day rows above and below —
 *     says how many more there are behind it.
 *
 * The checkbox is kept: completing the oldest occurrence of an overdue task is
 * the single most likely thing to want to do from this row, and it means
 * exactly what it shows (the count drops by one, and the next-oldest becomes
 * the representative). Tapping anywhere else opens that occurrence's entry; the
 * rest of the group is reachable by scrolling back to its own days.
 */
function AgendaOverdueGroupRow({ occ, count, oldest, onOpen, onToggleDone }: Props) {
  const roots     = useStore(s => s.roots)
  const backlinks = useStore(s => s.backlinks)
  const listedOn  = (backlinks.get(occ.entryKey) ?? []).map(key => roots.get(key)?.title ?? key)

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
      {/* No overflow-hidden wrapper here (that exists in AgendaRow only to clip
          the swipe reveal), so the shadow can sit directly on the card's box. */}
      <div className="relative rounded-lg flex-1 min-w-0 shadow-(--shadow-card)" data-occ-key={occ.id}>
        <OccurrenceCard
          occ={occ}
          leadingIcon="checkbox"
          onOpen={() => onOpen(occ)}
          onToggleDone={() => onToggleDone(occ)}
          showDate
          listedOn={listedOn}
          animate={false}
        />
      </div>
    </div>
  )
}

export default memo(AgendaOverdueGroupRow)
