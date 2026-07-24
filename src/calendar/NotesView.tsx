import { NotebookPen } from 'lucide-react'
import { useStore } from '@/store'
import type { Occurrence, EditScope } from '@/types'
import { occKind } from '@/occView'
import { toggleOccDone, beginSwipeDelete } from '@/occurrenceActions'
import { sortOccs } from './occSort'
import { undatedOccs } from './undatedOccs'
import OccurrenceList from './OccurrenceList'
import { useToday } from '@/hooks'

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

// Notes — standalone occurrences that are neither dated nor tasks. They carry no
// priority or time, so sortOccs collapses to a plain alphabetical title order.
export default function NotesView({ onOpen }: Props) {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  // Notes resolve to 'note' before occState ever reads the clock, so any
  // value works here — useToday is cheaper than a ticking clock of our own.
  const today = useToday()

  const occs = sortOccs(undatedOccs(items, roots).filter(o => occKind(o) === 'note'), today)

  const handleToggleDone  = (occ: Occurrence) => toggleOccDone(occ)
  const handleSwipeDelete = (occ: Occurrence) => beginSwipeDelete(occ)

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
      <div className="pb-24 lg:max-w-3xl lg:mx-auto">
        {occs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 pt-24 text-center text-muted-foreground">
            <NotebookPen size={32} strokeWidth={1.5} className="opacity-60" />
            <p className="text-base text-foreground">No notes yet</p>
            <p className="text-sm">Notes without a date show up here.</p>
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
