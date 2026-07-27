import { NotebookPen } from 'lucide-react'
import type { Occurrence, EditScope } from '@/types'
import UndatedListView from './UndatedListView'

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

// Notes — standalone occurrences that are neither dated nor tasks. They carry no
// priority or time, so sortOccs collapses to a plain alphabetical title order.
export default function NotesView({ onOpen }: Props) {
  return (
    <UndatedListView
      kind="note"
      Icon={NotebookPen}
      emptyTitle="No notes yet"
      emptyHint="Notes without a date show up here."
      onOpen={onOpen}
    />
  )
}
