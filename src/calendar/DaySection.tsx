import { memo, useRef } from 'react'
import type { Occurrence } from '../types'
import { multidayDisplayTitle } from '../model/expansion'
import { fmtLong } from '../presentation'
import { cn } from '../lib/utils'
import OccurrenceRow from './OccurrenceRow'
import { useFlipReorder } from '../hooks/useFlipReorder'


interface Props {
  dateKey: string
  date: Date
  isToday: boolean
  isTomorrow: boolean
  items: Occurrence[]
  onOpen: (occ: Occurrence) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

function DaySection({
  dateKey, date, isToday, isTomorrow,
  items,
  onOpen, onToggleDone, onSwipeDelete,
}: Props) {
  const sectionRef = useRef<HTMLDivElement>(null)
  useFlipReorder(sectionRef, items)

  const label = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : fmtLong(date)

  return (
    <div className="day-section scroll-mt-2" data-key={dateKey} ref={sectionRef}>
      <div className={cn(
        'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-muted-foreground',
        'flex items-center gap-2 sticky top-0 bg-background z-[3]',
        'after:content-[""] after:flex-1 after:h-px after:bg-border',
        isToday && 'text-primary',
      )}>{label}</div>

      {/* Occurrence rows */}
      {items.map((o, i) => (
        <OccurrenceRow
          key={o.id}
          occ={o}
          index={i}
          onOpen={() => onOpen(o)}
          onToggleDone={() => onToggleDone(o)}
          onSwipeDelete={() => onSwipeDelete(o)}
          displayTitle={o.metadata.jsTime ? multidayDisplayTitle(o, o.metadata.jsTime) : undefined}
        />
      ))}
    </div>
  )
}

function propsAreEqual(prev: Props, next: Props): boolean {
  if (prev.isToday !== next.isToday || prev.isTomorrow !== next.isTomorrow) return false
  if (prev.items.length !== next.items.length) return false
  if (!prev.items.every((o, i) => {
    const n = next.items[i]
    return o.fileSlug === n.fileSlug && o.date === n.date && o.time === n.time
        && o.metadata.done === n.metadata.done && o.metadata.title === n.metadata.title
        && o.metadata.priority === n.metadata.priority
        && o.metadata.duration === n.metadata.duration
        && JSON.stringify(o.metadata.tags) === JSON.stringify(n.metadata.tags)
        && JSON.stringify(o.metadata.topics) === JSON.stringify(n.metadata.topics)
        && JSON.stringify(o.metadata.participants) === JSON.stringify(n.metadata.participants)
  })) return false
  return true
}

export default memo(DaySection, propsAreEqual)
