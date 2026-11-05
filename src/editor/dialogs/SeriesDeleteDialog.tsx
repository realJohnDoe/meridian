import { TriangleAlert } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { buttonVariants } from '@/components/ui/button'
import type { SeriesSheetConfig } from '@/editor/save'
import DeleteDialogFooter from './DeleteDialogFooter'

interface Props {
  config: SeriesSheetConfig | null
  onClose: () => void
}

/**
 * One tap per scope, no separate confirm: every option commits through an
 * undo toast (see `occurrenceActions.ts`), so a pick-then-confirm step would
 * guard against nothing.
 */
export default function SeriesDeleteDialog({ config, onClose }: Props) {
  return (
    <AlertDialog open={!!config} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{config?.title ?? 'Delete recurring event'}</AlertDialogTitle>
          <AlertDialogDescription className="sr-only">Choose what to delete.</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex flex-col gap-2">
          {config?.options.map(opt => (
            <div key={opt.label} className="flex flex-col gap-1">
              <AlertDialogAction
                className={buttonVariants({ variant: 'destructive', className: 'w-full' })}
                onClick={() => { opt.onClick(); onClose() }}
              >
                {opt.label}
              </AlertDialogAction>
              {opt.warning && (
                <p className="flex items-start gap-1.5 px-1 text-xs text-muted-foreground">
                  <TriangleAlert size={12} className="shrink-0 mt-0.5 text-warning-foreground" />
                  <span>{opt.warning}</span>
                </p>
              )}
            </div>
          ))}
        </div>

        <DeleteDialogFooter
          onClose={onClose}
          onArchive={config?.onArchive ? () => { config.onArchive?.(); onClose() } : undefined}
          archiveLabel="Archive whole file instead"
        />
      </AlertDialogContent>
    </AlertDialog>
  )
}
