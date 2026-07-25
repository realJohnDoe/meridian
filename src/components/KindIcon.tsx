import { CheckSquare, CalendarDays, FileText } from 'lucide-react'
import { isTracked } from '@/types'

/** Minimal shape satisfied by both Occurrence and StoreItem. */
interface Kindable {
  date?: string | null
  metadata: { done?: boolean }
}

interface Props {
  item: Kindable | undefined
  size?: number
  className?: string
}

/**
 * Renders the canonical type icon for any item or occurrence.
 * Logic mirrors occKind(): task (done tracked) → CheckSquare,
 * event (has date) → CalendarDays, note → FileText.
 * Treats undefined item as a note.
 */
export default function KindIcon({ item, size = 13, className }: Props) {
  if (isTracked(item))
    return <CheckSquare size={size} className={className} />
  if (item?.date)
    return <CalendarDays size={size} className={className} />
  return <FileText size={size} className={className} />
}
