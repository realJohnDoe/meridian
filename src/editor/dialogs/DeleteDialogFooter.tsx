import { Archive, Trash2 } from 'lucide-react'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'

interface Props {
  onClose: () => void
  onDelete: () => void
  deleteLabel?: string
  onArchive?: () => void
  archiveLabel?: string
}

/** Shared Cancel/Archive/Delete button row for the delete dialogs. */
export default function DeleteDialogFooter(props: Props) {
  const { onClose, onDelete, onArchive } = props
  const deleteLabel = props.deleteLabel ?? 'Delete'
  const archiveLabel = props.archiveLabel ?? 'Archive instead'
  return (
    <AlertDialogFooter className="gap-2 sm:gap-0">
      <AlertDialogCancel onClick={onClose} className="mt-0">Cancel</AlertDialogCancel>
      {onArchive && (
        <AlertDialogAction
          className="bg-priority-3 text-priority-3-foreground hover:bg-priority-3/90 gap-1.5"
          onClick={onArchive}
        >
          <Archive size={13} />
          {archiveLabel}
        </AlertDialogAction>
      )}
      <AlertDialogAction
        className="bg-priority-1 text-priority-1-foreground hover:bg-priority-1/90 gap-1.5"
        onClick={onDelete}
      >
        <Trash2 size={13} />
        {deleteLabel}
      </AlertDialogAction>
    </AlertDialogFooter>
  )
}
