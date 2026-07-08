import { useState } from 'react'
import { TriangleAlert } from 'lucide-react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useResetOnChange } from '@/hooks'
import type { SeriesSheetConfig } from '@/editor/save'

interface Props {
  config: SeriesSheetConfig | null
  onClose: () => void
}

export default function SeriesDeleteDialog({ config, onClose }: Props) {
  const [selected, setSelected] = useState('0')

  // Default to first option whenever the dialog opens
  useResetOnChange([config], () => {
    if (config) setSelected('0')
  })

  function handleDelete() {
    config?.options[Number(selected)]?.onClick()
    onClose()
  }

  const selectedWarning = config?.options[Number(selected)]?.warning

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
              key={opt.label}
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

        {selectedWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            <TriangleAlert size={14} className="shrink-0 mt-0.5" />
            <span>{selectedWarning}</span>
          </div>
        )}

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
