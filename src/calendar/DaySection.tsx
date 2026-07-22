import { memo } from 'react'
import type { Occurrence } from '@/types'
import { fmtLong } from '@/format'
import { cn } from '@/lib/cn'
import OccurrenceRow from './OccurrenceRow'
import { FlipList } from '@/components'


interface Props {
  date: Date
  isToday: boolean
  isTomorrow: boolean
  items: Occurrence[]
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
  /**
   * Current time, refreshed once a minute for today's section only (omitted
   * for other days, whose event-past/event-future state can't change from
   * the clock alone). Forwarded to each OccurrenceRow, and also read here in
   * propsAreEqual: without that check, this section — and thus its rows —
   * would never re-render on a tick when its items are otherwise unchanged,
   * so the fresh `now` would never reach OccurrenceRow's own memo.
   */
  now?: Date
}

function DaySection({
  date, isToday, isTomorrow,
  items,
  onOpen, onToggleDone, onSwipeDelete,
  now,
}: Props) {
  const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : fmtLong(date)

  // animateHeight stays off: AgendaView virtualizes these sections and
  // measures them itself, so an animated height would feed the virtualizer a
  // resize per frame and set it fighting the animation.
  return (
    <FlipList items={items} itemAttr="data-occ-key">
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
          now={now}
          onOpen={onOpen}
          onToggleDone={onToggleDone}
          onSwipeDelete={onSwipeDelete}
        />
      ))}
    </FlipList>
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
export function propsAreEqual(prev: Props, next: Props): boolean {
  if (prev.isToday !== next.isToday || prev.isTomorrow !== next.isTomorrow) return false
  if (prev.now !== next.now) return false
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
