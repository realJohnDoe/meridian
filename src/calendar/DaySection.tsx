import { memo, useRef } from 'react'
import type { Occurrence } from '@/types'
import { fmtLong } from '@/format'
import { cn } from '@/lib/cn'
import OccurrenceRow from './OccurrenceRow'
import { useFlipReorder } from '@/hooks'


interface Props {
  date: Date
  isToday: boolean
  isTomorrow: boolean
  items: Occurrence[]
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
  /**
   * Bumped once a minute for today's section only. Not read in the body —
   * its only job is to appear in propsAreEqual below so this section is
   * forced to re-render (and its rows recompute wall-clock styling) once a
   * minute even when its items are otherwise unchanged.
   */
  tick?: number
}

function DaySection({
  date, isToday, isTomorrow,
  items,
  onOpen, onToggleDone, onSwipeDelete,
}: Props) {
  const sectionRef = useRef<HTMLDivElement>(null)
  useFlipReorder(sectionRef, items)

  const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : fmtLong(date)

  return (
    <div ref={sectionRef}>
      <div className={cn(
        'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-secondary-foreground',
        'flex items-center gap-2 bg-background',
        'after:content-[""] after:flex-1 after:h-px after:bg-border',
        isToday && 'text-primary',
      )}>{label}</div>

      {/* Occurrence rows */}
      {items.map(o => (
        <OccurrenceRow
          key={o.id}
          occ={o}
          onOpen={onOpen}
          onToggleDone={onToggleDone}
          onSwipeDelete={onSwipeDelete}
        />
      ))}
    </div>
  )
}

// Kept under the React Compiler on purpose: `items` is rebuilt into a new
// array every time an unrelated occurrence changes anywhere (grouping logic
// upstream), even when this day's own entries are unchanged field-for-field.
// The compiler's automatic memoization only compares the `items` reference
// itself — it has no domain knowledge that two different array instances can
// represent the same day. This comparator supplies that domain knowledge
// (field-level equality per occurrence) and isn't something compiler-only
// memoization can infer or replace.
function propsAreEqual(prev: Props, next: Props): boolean {
  if (prev.isToday !== next.isToday || prev.isTomorrow !== next.isTomorrow) return false
  if (prev.tick !== next.tick) return false
  if (prev.items.length !== next.items.length) return false
  return prev.items.every((o, i) => {
    const n = next.items[i]
    return o.id === n.id && o.ownerId === n.ownerId
        && o.fileSlug === n.fileSlug && o.date === n.date && o.time === n.time
        && o.metadata.done === n.metadata.done && o.metadata.title === n.metadata.title
        && o.metadata.priority === n.metadata.priority
        && o.metadata.duration === n.metadata.duration
        && JSON.stringify(o.metadata.tags) === JSON.stringify(n.metadata.tags)
        && JSON.stringify(o.metadata.items) === JSON.stringify(n.metadata.items)
        && JSON.stringify(o.metadata.participants) === JSON.stringify(n.metadata.participants)
  })
}

export default memo(DaySection, propsAreEqual)
