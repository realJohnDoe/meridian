import { toast } from 'sonner'
import { toggleDone, excludeOccurrence, deletionEndsAfterCompletionSeries, deleteByFileSlug } from '@/model'
import { occIsRecur } from './occView'
import type { Occurrence } from './types'
import { getItems, getRoots, setData } from './storeBridge'
import { writeEntity, deleteEntity } from './persistencePort'
import { commitNext } from './storeCommit'

let _toastId:       string | number | null = null
let _pendingCommit: (() => void) | null    = null
const TOAST_MS = 4000

function showDeleteToast(
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

export function toggleOccDone(o: Occurrence): void {
  const snapshot = { items: getItems(), roots: getRoots() }
  const next = toggleDone(snapshot, o)
  commitNext(next, [o.fileSlug])
}

export function beginSwipeDelete(o: Occurrence): () => void {
  const snapshot = { items: getItems(), roots: getRoots() }
  const title    = o.metadata.title
  let cancelled  = false

  if (occIsRecur(o)) {
    const next = excludeOccurrence(snapshot, o)
    const endsSeries = deletionEndsAfterCompletionSeries(snapshot.items, o)
    showDeleteToast(title,
      () => { writeEntity(o.fileSlug) },
      () => { cancelled = true; setData(snapshot) },
      { endsSeries },
    )
    return () => { if (!cancelled) setData(next) }
  } else {
    showDeleteToast(title,
      () => { deleteEntity(o.fileSlug) },
      () => {
        cancelled = true
        if (!getItems().find(i => i.id === o.id)) setData(snapshot)
      },
    )
    return () => {
      if (!cancelled) setData(deleteByFileSlug({ items: getItems(), roots: getRoots() }, o.fileSlug))
    }
  }
}

