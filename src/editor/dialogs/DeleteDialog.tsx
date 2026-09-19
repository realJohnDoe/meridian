import type { ReactNode } from 'react'
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
   * Overrides the heading and body for a destructive action that is not a
   * plain delete — removing a repeat, which deletes the series' changed
   * occurrences along with the rule. Same dialog on purpose: it is the same
   * promise to the user (this is irreversible, here is what goes, cancel is
   * the safe answer), and giving that promise a second look would be how the
   * two drift apart.
   */
  heading?: string
  description?: ReactNode
  confirmLabel?: string
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

export default function DeleteDialog({ open, title, onConfirm, onClose, onArchive, heading, description, confirmLabel }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{heading ?? 'Delete'}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? <>Delete &ldquo;{title}&rdquo;? This cannot be undone.</>}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <DeleteDialogFooter
          onClose={onClose}
          onDelete={() => { onConfirm(); onClose() }}
          deleteLabel={confirmLabel}
          onArchive={onArchive ? () => { onArchive(); onClose() } : undefined}
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
