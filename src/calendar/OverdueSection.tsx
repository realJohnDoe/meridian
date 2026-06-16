import { memo } from 'react'
import type { Occurrence, EditScope } from '../types'
import { multidayDisplayTitle } from '../model/expansion'
import { cn } from '../lib/utils'
import OccurrenceRow from './OccurrenceRow'


interface Props {
  items: Occurrence[]
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

function OverdueSection({ items, onOpen, onToggleDone, onSwipeDelete }: Props) {
  return (
    <div className="day-section scroll-mt-2" data-overdue>
      <div className={cn(
        'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-yellow-500',
        'flex items-center gap-2 sticky top-0 bg-background z-[3]',
        'after:content-[""] after:flex-1 after:h-px after:bg-border',
      )}>Overdue</div>

      {items.map((o, i) => (
        <OccurrenceRow
          key={o.id}
          occ={o}
          index={i}
          showDate={true}
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
  if (prev.items.length !== next.items.length) return false
  return prev.items.every((o, i) => {
    const n = next.items[i]
    return o.id === n.id && o.date === n.date
        && o.metadata.done === n.metadata.done
        && o.metadata.title === n.metadata.title
        && o.metadata.priority === n.metadata.priority
  })
}

export default memo(OverdueSection, propsAreEqual)
