import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { Archive, Trash2 } from 'lucide-react'

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
   * PR 2. Rendered as a secondary action, deliberately not styled like
   * `onConfirm`: it isn't destructive, and it isn't the primary choice either.
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
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          {onArchive && (
            <AlertDialogAction
              className={cn(buttonVariants({ variant: 'secondary' }), 'gap-1.5')}
              onClick={() => { onArchive(); onClose() }}
            >
              <Archive size={13} />
              Archive instead
            </AlertDialogAction>
          )}
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            onClick={() => { onConfirm(); onClose() }}
          >
            <Trash2 size={13} />
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
