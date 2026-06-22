import RepeatDialog from './dialogs/RepeatDialog'
import DatePickerDialog from './dialogs/DatePickerDialog'
import DeleteDialog from './dialogs/DeleteDialog'
import SeriesDeleteDialog from './dialogs/SeriesDeleteDialog'
import PriorityDrawer from './dialogs/PriorityDrawer'
import TimePickerDialog from './dialogs/TimePickerDialog'
import DurationDialog from './dialogs/DurationDialog'
import { fmtISO } from '@/model/dateUtils'
import { useToday } from '@/hooks/useToday'
import type { EntryState } from './state'
import type { DialogHandlers } from './useEntryEditor'

interface Props {
  entry: EntryState
  handlers: DialogHandlers
}

export default function DialogStack({ entry, handlers }: Props) {
  const {
    activeDialog, pendingDelete, seriesSheetConfig,
    onClose, onDateConfirm, onDateRemove, onPriority,
    onTimeConfirm, onTimeRemove, onDurConfirm, onDurRemove,
    onRepeatConfirm, onRepeatRemove, onSeriesClose, onDeleteClose,
  } = handlers
  const today = useToday()
  return (
    <>
      <DatePickerDialog
        open={activeDialog === 'dlgSched'}
        initialDate={entry.scheduled?.date || fmtISO(today)}
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
