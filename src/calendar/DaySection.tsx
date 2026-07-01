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
   * Bumped once a minute for today's section only. Occurrence rows are
   * memoized on `occ` identity, so without this, time-based styling
   * (event-past/event-future) can go stale until an unrelated prop changes.
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

  // Any time this component actually renders — whether from the minute
  // ticker above or from an unrelated item in this day changing — every row
  // needs to recompute its own wall-clock-dependent styling. Rows are
  // individually memoized on `occ` identity, so forwarding the ticker's
  // `tick` value as-is isn't enough: an untouched row's props would be
  // unchanged on a render triggered by a SIBLING's change, and its memo
  // would bail. A fresh per-render stamp guarantees every row's props
  // differ from its own last render, whatever triggered this one.
  const renderStamp = Date.now()

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
          tick={renderStamp}
          onOpen={onOpen}
          onToggleDone={onToggleDone}
          onSwipeDelete={onSwipeDelete}
        />
      ))}
    </div>
  )
}

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
