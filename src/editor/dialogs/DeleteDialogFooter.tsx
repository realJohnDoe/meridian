import { Trash2 } from 'lucide-react'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'

interface Props {
  onClose: () => void
  /** Omitted by `SeriesDeleteDialog`, whose scope buttons are the delete actions. */
  onDelete?: () => void
  deleteLabel?: string
  onArchive?: () => void
  archiveLabel?: string
}

/**
 * Shared footer for the delete dialogs. Archive is a quiet text action on the
 * left — a real alternative, but not a peer of the destructive button(s).
 */
export default function DeleteDialogFooter(props: Props) {
  const { onClose, onDelete, onArchive } = props
  return (
    <AlertDialogFooter className="gap-2 sm:gap-0">
      {onArchive && (
        <AlertDialogAction
          className="bg-transparent px-0 text-muted-foreground underline-offset-4 shadow-none hover:bg-transparent hover:text-foreground hover:underline sm:mr-auto"
          onClick={onArchive}
        >
          {props.archiveLabel ?? 'Archive instead'}
        </AlertDialogAction>
      )}
      <AlertDialogCancel onClick={onClose} className="mt-0">Cancel</AlertDialogCancel>
      {onDelete && (
        <AlertDialogAction
          className="bg-priority-1 text-priority-1-foreground hover:bg-priority-1/90 gap-1.5"
          onClick={onDelete}
        >
          <Trash2 size={13} />
          {props.deleteLabel ?? 'Delete'}
        </AlertDialogAction>
      )}
    </AlertDialogFooter>
  )
}
