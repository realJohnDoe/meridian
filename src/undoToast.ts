import { toast } from 'sonner'
import { format } from 'date-fns'
import { parseDateString } from './model/dateUtils'

let _toastId:       string | number | null = null
let _pendingCommit: (() => void) | null    = null
let _doneMovedId:   string | number | null = null
const TOAST_MS = 4000

export function showDeleteToast(title: string, commitFn: () => void, undoFn: () => void): void {
  if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
  if (_toastId !== null) { toast.dismiss(_toastId); _toastId = null }

  _pendingCommit = commitFn
  _toastId = toast(`Deleted: ${title}`, {
    duration: TOAST_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        _pendingCommit = null
        _toastId = null
        undoFn()
      },
    },
    onDismiss: () => {
      if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
      _toastId = null
    },
    onAutoClose: () => {
      if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
      _toastId = null
    },
  })
}

export function showDoneMovedToast(title: string, originalDate: string, revertFn: () => void): void {
  if (_doneMovedId !== null) { toast.dismiss(_doneMovedId); _doneMovedId = null }

  const d = parseDateString(originalDate)
  const actionLabel = d
    ? `Set as done on ${format(d, 'MMM d')} instead`
    : 'Set as done without date'

  _doneMovedId = toast(`Marked done today: ${title}`, {
    duration: TOAST_MS,
    action: {
      label: actionLabel,
      onClick: () => { _doneMovedId = null; revertFn() },
    },
    onDismiss:   () => { _doneMovedId = null },
    onAutoClose: () => { _doneMovedId = null },
  })
}
