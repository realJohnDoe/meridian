import { memo } from 'react'
import type { Occurrence, EditScope } from '@/types'
import { cn } from '@/lib/cn'
import OccurrenceRow from './OccurrenceRow'


interface Props {
  items: Occurrence[]
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

function OverdueSection({ items, onOpen, onToggleDone, onSwipeDelete }: Props) {
  return (
    <div>
      <div className={cn(
        'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-yellow-500',
        'flex items-center gap-2 bg-background',
        'after:content-[""] after:flex-1 after:h-px after:bg-border',
      )}>Overdue</div>

      {items.map(o => (
        <OccurrenceRow
          key={`${o.id}-${o.metadata.jsTime?.getTime() ?? ''}`}
          occ={o}
          showDate={true}
          onOpen={onOpen}
          onToggleDone={onToggleDone}
          onSwipeDelete={onSwipeDelete}
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
        && o.metadata.jsTime?.getTime() === n.metadata.jsTime?.getTime()
        && o.metadata.done === n.metadata.done
        && o.metadata.title === n.metadata.title
        && o.metadata.priority === n.metadata.priority
  })
}

export default memo(OverdueSection, propsAreEqual)
