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
import { RadioGroup, RadioGroupItem } from './ui/radio-group'
import type { SeriesSheetConfig } from '@/editor/save'

interface Props {
  config: SeriesSheetConfig | null
  onClose: () => void
}

export default function SeriesDeleteDialog({ config, onClose }: Props) {
  const [selected, setSelected] = useState('0')

  // Default to first option whenever the dialog opens
  useEffect(() => {
    if (config) setSelected('0')
  }, [config])

  function handleDelete() {
    config?.options[Number(selected)]?.onClick()
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

        <RadioGroup value={selected} onValueChange={setSelected} className="gap-1 -mx-1">
          {config?.options.map((opt, i) => (
            <label
              key={i}
              htmlFor={`series-opt-${i}`}
              className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-colors border
                         border-transparent hover:bg-white/5
                         has-data-[state=checked]:bg-destructive/10 has-data-[state=checked]:border-destructive/30"
            >
              <RadioGroupItem
                id={`series-opt-${i}`}
                value={String(i)}
                className="border-muted-foreground/50 text-destructive data-[state=checked]:border-destructive shrink-0"
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground leading-snug">
                  {opt.label}
                </div>
                <div className="text-xs text-muted-foreground leading-snug mt-0.5">
                  {opt.sublabel}
                </div>
              </div>
            </label>
          ))}
        </RadioGroup>

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
