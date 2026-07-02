import { toast } from 'sonner'

let _toastId:       string | number | null = null
let _pendingCommit: (() => void) | null    = null
const TOAST_MS = 4000

export function showDeleteToast(
  title: string,
  commitFn: () => void,
  undoFn: () => void,
  opts?: { endsSeries?: boolean },
): void {
  if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
  if (_toastId !== null) { toast.dismiss(_toastId); _toastId = null }

  _pendingCommit = commitFn
  const message = opts?.endsSeries
    ? `Deleted: ${title} — this series only repeats after completion, so it ends here.`
    : `Deleted: ${title}`
  const toastFn = opts?.endsSeries ? toast.warning : toast
  _toastId = toastFn(message, {
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

