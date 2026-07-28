import type { LucideIcon } from 'lucide-react'
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
  kind: 'task' | 'note'
  Icon: LucideIcon
  emptyTitle: string
  emptyHint: string
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

// Shared list for standalone (undated) tasks and notes — BacklogView and
// NotesView differ only in which kind they filter to and their empty-state copy.
export default function UndatedListView({ kind, Icon, emptyTitle, emptyHint, onOpen }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  // Undated tasks/notes resolve to a kind-specific state before occState ever
  // reads the clock, so any value works here — useToday is cheaper than a
  // ticking clock of our own.
  const today = useToday()

  const all  = undatedOccs(items, roots).filter(o => occKind(o) === kind)
  const occs = sortOccs(useParticipantFilteredOccs(all), today)

  const handleToggleDone  = (occ: Occurrence) => toggleOccDone(occ)
  const handleSwipeDelete = (occ: Occurrence) => beginSwipeDelete(occ)

  // OccurrenceList brings its own scroll container — its virtualizer has to
  // read that element from a ref of its own, and a ref owned by this component
  // would still be null when the virtualizer's layout effect runs on first
  // mount (React attaches a host element's ref after its descendants' layout
  // effects). So only the empty state is wrapped here.
  if (occs.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <div className="pb-24 lg:max-w-3xl lg:mx-auto">
          <ListEmptyState
            Icon={Icon}
            title={emptyTitle}
            hint={emptyHint}
            filtered={all.length > 0}
          />
        </div>
      </div>
    )
  }

  return (
    <OccurrenceList
      occs={occs}
      onOpen={onOpen}
      onToggleDone={handleToggleDone}
      onSwipeDelete={handleSwipeDelete}
    />
  )
}
