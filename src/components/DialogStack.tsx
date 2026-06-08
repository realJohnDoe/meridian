import RepeatDialog from './RepeatDialog'
import DatePickerDialog from './DatePickerDialog'
import DeleteDialog from './DeleteDialog'
import SeriesDeleteDialog from './SeriesDeleteDialog'
import PriorityDrawer from './PriorityDrawer'
import TimePickerDialog from './TimePickerDialog'
import DurationDialog from './DurationDialog'
import { fmtISO } from '../model/expansion'
import { TODAY } from '../constants'
import type { EntryState } from './EntryEditor'
import type { SeriesSheetConfig } from '../mutations'
import type { Priority } from '../types'

interface Props {
  entry: EntryState
  activeDialog: string | null
  pendingDelete: { title: string; onConfirm: () => void } | null
  seriesSheetConfig: SeriesSheetConfig | null
  onClose: () => void
  onDateConfirm: (dateStr: string) => void
  onDateRemove: () => void
  onPriority: (p: Priority | null) => void
  onTimeConfirm: (hhmm: string) => void
  onTimeRemove: () => void
  onDurConfirm: (dur: string) => void
  onDurRemove: () => void
  onRepeatConfirm: (repeat: EntryState['repeat']) => void
  onRepeatRemove: () => void
  onSeriesClose: () => void
  onDeleteClose: () => void
}

export default function DialogStack({
  entry, activeDialog, pendingDelete, seriesSheetConfig,
  onClose, onDateConfirm, onDateRemove, onPriority,
  onTimeConfirm, onTimeRemove, onDurConfirm, onDurRemove,
  onRepeatConfirm, onRepeatRemove, onSeriesClose, onDeleteClose,
}: Props) {
  return (
    <>
      <DatePickerDialog
        open={activeDialog === 'dlgSched'}
        initialDate={entry.scheduled?.date || fmtISO(TODAY)}
        onConfirm={onDateConfirm}
        onRemove={onDateRemove}
        onClose={onClose}
      />

      <PriorityDrawer
        open={activeDialog === 'dlgPriority'}
        value={entry.priority}
        onSelect={onPriority}
        onClose={onClose}
      />

      <TimePickerDialog
        open={activeDialog === 'dlgTime'}
        value={entry.scheduled?.time || ''}
        onConfirm={onTimeConfirm}
        onRemove={onTimeRemove}
        onClose={onClose}
      />

      <DurationDialog
        open={activeDialog === 'dlgDur'}
        value={entry.duration || ''}
        onConfirm={onDurConfirm}
        onRemove={onDurRemove}
        onClose={onClose}
      />

      <RepeatDialog
        open={activeDialog === 'dlgRepeat'}
        scheduled={entry.scheduled}
        tracked={entry.tracked}
        itemType={entry.itemType}
        repeat={entry.repeat}
        onConfirm={onRepeatConfirm}
        onRemove={onRepeatRemove}
        onClose={onClose}
      />

      <SeriesDeleteDialog
        config={seriesSheetConfig}
        onClose={onSeriesClose}
      />

      <DeleteDialog
        open={!!pendingDelete}
        title={pendingDelete?.title ?? ''}
        onConfirm={() => pendingDelete?.onConfirm()}
        onClose={onDeleteClose}
      />
    </>
  )
}
