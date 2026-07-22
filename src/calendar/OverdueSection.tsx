import { memo } from 'react'
import type { Occurrence, EditScope } from '@/types'
import { cn } from '@/lib/cn'
import { FlipList } from '@/components'
import OccurrenceRow from './OccurrenceRow'


interface Props {
  items: Occurrence[]
  onOpen: (occ: Occurrence, scope?: EditScope) => void
  onToggleDone: (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

function OverdueSection({ items, onOpen, onToggleDone, onSwipeDelete }: Props) {
  // Completing an overdue task drops it from this section, so its height does
  // snap — but animateHeight can't fix that here: AgendaView virtualizes and
  // measures these sections, and this one sits above today, where a resize
  // per frame would drag the library's scroll compensation along with it.
  return (
    <FlipList items={items} itemAttr="data-occ-key">
      <div className={cn(
        'px-3.5 pt-3.5 pb-1.5 text-xs font-bold tracking-[.08em] uppercase text-warning',
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
    </FlipList>
  )
}

// Kept under the React Compiler for the same reason as DaySection's
// propsAreEqual: `items` is a freshly built array on every unrelated
// occurrence change, and only per-field equality (not array identity) can
// tell whether this section's own content actually changed. The compiler's
// automatic memoization compares the `items` reference, not its contents.
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
