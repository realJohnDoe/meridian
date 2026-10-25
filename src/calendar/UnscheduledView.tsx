import { Inbox } from 'lucide-react'
import type { Occurrence, EditScope } from '@/types'
import UndatedListView from './UndatedListView'

interface Props {
  onOpen: (occ: Occurrence, scope?: EditScope) => void
}

// Unscheduled tasks — standalone task occurrences with no date. Sorted by
// priority then title (sortOccs collapses to that order when there is no time).
export default function UnscheduledView({ onOpen }: Props) {
  return (
    <UndatedListView
      kind="task"
      Icon={Inbox}
      emptyTitle="No unscheduled tasks"
      emptyHint="Tasks without a date show up here."
      onOpen={onOpen}
    />
  )
}
