import { useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Occurrence, EditScope } from '@/types'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import OccurrenceRow from './OccurrenceRow'

interface Props {
  // Pre-sorted occurrences. Done items are split out into a collapsible section;
  // if there are none (e.g. notes), the section is omitted entirely.
  occs:          Occurrence[]
  onOpen:        (occ: Occurrence, scope?: EditScope) => void
  onToggleDone:  (occ: Occurrence) => void
  onSwipeDelete: (occ: Occurrence) => (() => void)
}

export default function OccurrenceList({ occs, onOpen, onToggleDone, onSwipeDelete }: Props) {
  const { active, done } = useMemo(() => ({
    active: occs.filter(o => !o.metadata.done),
    done:   occs.filter(o =>  o.metadata.done),
  }), [occs])

  return (
    <div className="pt-2">
      {active.map(o => (
        <OccurrenceRow
          key={o.id}
          occ={o}
          onOpen={onOpen}
          onToggleDone={onToggleDone}
          onSwipeDelete={onSwipeDelete}
        />
      ))}

      {done.length > 0 && (
        <Collapsible defaultOpen={false} className="mt-2">
          <CollapsibleTrigger className="flex items-center gap-1 mx-3.5 mb-1 text-xs font-bold text-secondary-foreground tracking-[.08em] uppercase hover:text-foreground transition-colors [&[data-state=open]>svg]:rotate-180">
            <ChevronDown size={12} className="transition-transform duration-200" />
            Done · {done.length}
          </CollapsibleTrigger>
          <CollapsibleContent>
            {done.map(o => (
              <OccurrenceRow
                key={o.id}
                occ={o}
                onOpen={onOpen}
                onToggleDone={onToggleDone}
                onSwipeDelete={onSwipeDelete}
              />
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}
