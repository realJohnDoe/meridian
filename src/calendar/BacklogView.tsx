import { Inbox } from 'lucide-react'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { occKind } from '@/occView'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import { sortOccs } from './occSort'
import { undatedOccs } from './undatedOccs'
import { useParticipantFilteredOccs } from './useCalendarFilter'
import ListEmptyState from './ListEmptyState'
import OccurrenceList from './OccurrenceList'
import { useToday } from '@/hooks'

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

// Unscheduled tasks — standalone task occurrences with no date. Sorted by
// priority then title (sortOccs collapses to that order when there is no time).
export default function BacklogView({ onOpen }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  // Tasks resolve to task-p*/task-open before occState ever reads the clock,
  // so any value works here — useToday is cheaper than a ticking clock of our own.
  const today = useToday()

  const all  = undatedOccs(items, roots).filter(o => occKind(o) === 'task')
  const occs = sortOccs(useParticipantFilteredOccs(all), today)

  const handleToggleDone  = (occ: Occurrence) => toggleOccDone(occ)
  const handleSwipeDelete = (occ: Occurrence) => beginSwipeDelete(occ)

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
      <div className="pb-24 lg:max-w-3xl lg:mx-auto">
        {occs.length === 0 ? (
          <ListEmptyState
            Icon={Inbox}
            title="Your backlog is empty"
            hint="Tasks without a date show up here."
            filtered={all.length > 0}
          />
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
