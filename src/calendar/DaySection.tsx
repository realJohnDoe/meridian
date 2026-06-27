import { memo, useRef } from 'react'
import type { Occurrence } from '@/types'
import { fmtLong } from '@/format'
import { cn } from '@/lib/cn'
import OccurrenceRow from './OccurrenceRow'
import { useFlipReorder } from '@/hooks'


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
        />
      ))}
    </div>
  )
}

let _propsEqualCalls = 0, _propsEqualMs = 0, _propsEqualRafScheduled = false
function propsAreEqual(prev: Props, next: Props): boolean {
  const t0 = performance.now()
  _propsEqualCalls++
  if (!_propsEqualRafScheduled) {
    _propsEqualRafScheduled = true
    requestAnimationFrame(() => {
      console.log(`[perf:memo] DaySection propsAreEqual: ${_propsEqualCalls} calls, ${_propsEqualMs.toFixed(2)}ms total`)
      _propsEqualCalls = 0; _propsEqualMs = 0; _propsEqualRafScheduled = false
    })
  }
  if (prev.isToday !== next.isToday || prev.isTomorrow !== next.isTomorrow) { _propsEqualMs += performance.now() - t0; return false }
  if (prev.items.length !== next.items.length) { _propsEqualMs += performance.now() - t0; return false }
  const equal = prev.items.every((o, i) => {
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
  _propsEqualMs += performance.now() - t0
  return equal
}

export default memo(DaySection, propsAreEqual)
