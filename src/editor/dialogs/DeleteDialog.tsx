import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import DeleteDialogFooter from './DeleteDialogFooter'

interface Props {
  open: boolean
  /** Display name of the item being deleted */
  title: string
  onConfirm: () => void
  onClose: () => void
  /**
   * Archives the entry instead of deleting it. Optional so a caller with
   * nothing archivable (there is none today, but the type shouldn't assume
   * that forever) isn't forced to supply one — see `plans/archived-entries.md`
   * PR 2. Rendered in the priority-3 (yellow) tone, deliberately not
   * styled like `onConfirm`: it isn't destructive, but it's still a
   * consequential alternative to plain "Cancel", not the primary choice
   * either.
   */
  onArchive?: () => void
}

export default function DeleteDialog({ open, title, onConfirm, onClose, onArchive }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete</AlertDialogTitle>
          <AlertDialogDescription>
            Delete &ldquo;{title}&rdquo;? This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DeleteDialogFooter
          onClose={onClose}
          onDelete={() => { onConfirm(); onClose() }}
          onArchive={onArchive ? () => { onArchive(); onClose() } : undefined}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
