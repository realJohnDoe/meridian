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
   * Overrides the heading and body for a destructive action that has no undo
   * path of its own — removing a repeat, which deletes the series' changed
   * occurrences along with the rule and is asked about plainly ("cannot be
   * undone") because nothing here reverts it. The default body below makes no
   * such promise: `onConfirm` for a plain delete goes through an undo toast
   * (see `deleteNode`/`occurrenceActions.ts`), so there is nothing to warn
   * away from — Archive is offered as a real alternative, not a safety net.
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
            {description ?? <>Delete &ldquo;{title}&rdquo;, or archive it instead?</>}
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
