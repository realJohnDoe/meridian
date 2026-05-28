import { useState, useEffect } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { cn } from '@/lib/utils'
import type { SeriesSheetConfig } from '../meridian'

interface Props {
  config: SeriesSheetConfig | null
  onClose: () => void
}

export default function SeriesDeleteDialog({ config, onClose }: Props) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  // Default to first option whenever the dialog opens
  useEffect(() => {
    if (config) setSelectedIdx(0)
  }, [config])

  function handleDelete() {
    config?.options[selectedIdx]?.onClick()
    onClose()
  }

  return (
    <AlertDialog open={!!config} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{config?.title ?? 'Delete recurring event'}</AlertDialogTitle>
          <AlertDialogDescription>
            Choose which occurrences to remove.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Selectable option rows */}
        <div className="flex flex-col gap-1 -mx-1">
          {config?.options.map((opt, i) => (
            <button
              key={i}
              onClick={() => setSelectedIdx(i)}
              className={cn(
                'flex items-center gap-3 px-3 py-3 rounded-xl text-left w-full transition-colors border',
                selectedIdx === i
                  ? 'bg-destructive/10 border-destructive/30'
                  : 'border-transparent hover:bg-white/5',
              )}
            >
              {/* Radio indicator */}
              <div className={cn(
                'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
                selectedIdx === i ? 'border-destructive' : 'border-muted-foreground/50',
              )}>
                {selectedIdx === i && (
                  <div className="w-2 h-2 rounded-full bg-destructive" />
                )}
              </div>

              {/* Label + sublabel */}
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground leading-snug">
                  {opt.label}
                </div>
                <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                  {opt.sublabel}
                </div>
              </div>
            </button>
          ))}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            onClick={handleDelete}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
