import { Archive, Trash2 } from 'lucide-react'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'

interface Props {
  onClose: () => void
  /** Omitted by `SeriesDeleteDialog`, whose scope buttons are the delete actions. */
  onDelete?: () => void
  deleteLabel?: string
  onArchive?: () => void
  archiveLabel?: string
}

/**
 * Shared footer for the delete dialogs. Archive is outlined, like Cancel: a
 * real alternative to deleting, but not the primary action.
 */
export default function DeleteDialogFooter(props: Props) {
  const { onClose, onDelete, onArchive } = props
  return (
    <AlertDialogFooter className="gap-2 sm:gap-0">
      <AlertDialogCancel onClick={onClose} className="mt-0">Cancel</AlertDialogCancel>
      {onArchive && (
        <AlertDialogAction
          className={buttonVariants({ variant: 'outline', className: 'gap-1.5' })}
          onClick={onArchive}
        >
          <Archive size={13} />
          {props.archiveLabel ?? 'Archive instead'}
        </AlertDialogAction>
      )}
      {onDelete && (
        <AlertDialogAction
          className={buttonVariants({ variant: 'destructive', className: 'gap-1.5' })}
          onClick={onDelete}
        >
          <Trash2 size={13} />
          {props.deleteLabel ?? 'Delete'}
        </AlertDialogAction>
      )}
    </AlertDialogFooter>
  )
}
