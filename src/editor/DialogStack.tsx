import RepeatDialog from './dialogs/RepeatDialog'
import DatePickerDialog from './dialogs/DatePickerDialog'
import DeleteDialog from './dialogs/DeleteDialog'
import SeriesDeleteDialog from './dialogs/SeriesDeleteDialog'
import PriorityDrawer from './dialogs/PriorityDrawer'
import TimePickerDialog from './dialogs/TimePickerDialog'
import DurationDialog from './dialogs/DurationDialog'
import { fmtISO } from '@/model'
import { useToday } from '@/hooks'
import { itemTypeOf, type EntryState } from './state'
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
    pendingLoss, onLossClose,
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
        scheduled={entry.scheduled}
        itemType={itemTypeOf(entry)}
        onConfirm={onDurConfirm}
        onRemove={onDurRemove}
        onClose={onClose}
      />

      <RepeatDialog
        open={activeDialog === 'dlgRepeat'}
        scheduled={entry.scheduled}
        tracked={entry.tracked}
        itemType={itemTypeOf(entry)}
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
        onArchive={() => pendingDelete?.onArchive()}
        onClose={onDeleteClose}
      />
      <DeleteDialog
        open={!!pendingLoss}
        title={pendingLoss?.title ?? ''}
        heading={pendingLoss?.kind === 'change' ? 'Change repeat' : 'Remove repeat'}
        description={
          <>
            {pendingLoss?.kind === 'change'
              ? <>Change how &ldquo;{pendingLoss.title}&rdquo; repeats?{' '}</>
              : <>Stop &ldquo;{pendingLoss?.title}&rdquo; repeating?{' '}</>}
            {pendingLoss?.lost === 1
              ? 'Its 1 changed occurrence'
              : `Its ${pendingLoss?.lost ?? 0} changed occurrences`}
            {pendingLoss?.kind === 'change' ? ' on days it no longer repeats' : ''} will be deleted.{' '}
            This cannot be undone.
          </>
        }
        confirmLabel={pendingLoss?.kind === 'change' ? 'Change repeat' : 'Remove repeat'}
        onConfirm={() => pendingLoss?.onConfirm()}
        onClose={onLossClose}
      />
    </>
  )
}
