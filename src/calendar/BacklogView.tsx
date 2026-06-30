import { useMemo, useCallback } from 'react'
import { Inbox } from 'lucide-react'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { occKind } from '@/occView'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import { sortOccs } from './occSort'
import { undatedOccs } from './undatedOccs'
import OccurrenceList from './OccurrenceList'

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

// Unscheduled tasks — standalone task occurrences with no date. Sorted by
// priority then title (sortOccs collapses to that order when there is no time).
export default function BacklogView({ onOpen }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const occs = useMemo(
    () => sortOccs(undatedOccs(items, roots).filter(o => occKind(o) === 'task')),
    [items, roots],
  )

  const handleToggleDone  = useCallback((occ: Occurrence) => toggleOccDone(occ), [])
  const handleSwipeDelete = useCallback((occ: Occurrence) => beginSwipeDelete(occ), [])

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
      <div className="pb-24 lg:max-w-[720px] lg:mx-auto">
        {occs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 pt-24 text-center text-muted-foreground">
            <Inbox size={32} strokeWidth={1.5} className="opacity-60" />
            <p className="text-base text-foreground">Your backlog is empty</p>
            <p className="text-sm">Tasks without a date show up here.</p>
          </div>
        ) : (
          <OccurrenceList
            occs={occs}
            onOpen={onOpen}
            onToggleDone={handleToggleDone}
            onSwipeDelete={handleSwipeDelete}
          />
        )}
      </div>
    </div>
  )
}
