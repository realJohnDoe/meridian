import { toast } from 'sonner'
import { toggleDone, excludeOccurrence, deletionEndsAfterCompletionSeries, deleteByFileSlug, occFromAppMeta } from '@/model'
import { occIsRecur } from './occView'
import { isStandaloneOcc } from './types'
import type { Occurrence, OccurrenceEntry, OccurrenceMetadata, Roots, StoreItem } from './types'
import { getSnapshot, getItems, getRoots, setData } from './storeBridge'
import { writeEntity, deleteEntity } from './persistencePort'
import { commitNext } from './storeCommit'

let _toastId:       string | number | null = null
let _pendingCommit: (() => void) | null    = null
const TOAST_MS = 4000

// Restores only `fileSlug`'s items/root from `snapshot` into the *current*
// store, rather than reverting the whole store — an edit made to another
// file while the undo toast was up must survive. The restored slug is then
// re-persisted so the cache/backend agree with the reverted store.
function restoreFileSlug(snapshot: { items: StoreItem[]; roots: Roots }, fileSlug: string): void {
  const current = getSnapshot()
  const items = [
    ...current.items.filter(i => i.fileSlug !== fileSlug),
    ...snapshot.items.filter(i => i.fileSlug === fileSlug),
  ]
  const roots = new Map(current.roots)
  const snapshotRoot = snapshot.roots.get(fileSlug)
  if (snapshotRoot) roots.set(fileSlug, snapshotRoot)
  else roots.delete(fileSlug)
  setData({ items, roots })
  writeEntity(fileSlug)
}

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
  const snapshot = getSnapshot()
  const next = toggleDone(snapshot, o)
  commitNext(next, [o.fileSlug])
}

// Re-opens a done, undated occurrence: reuses an existing undated entry for
// the file if one exists, otherwise creates a fresh undated entry.
export function reopenOcc(occ: Occurrence): void {
  const allItems = getItems()
  const existingUndated = allItems.find(
    i => isStandaloneOcc(i) && i.fileSlug === occ.fileSlug && i.date === '',
  ) as OccurrenceEntry<OccurrenceMetadata> | undefined

  if (existingUndated) {
    commitNext({
      items: allItems.map(i => i.id === existingUndated.id
        ? { ...existingUndated, metadata: { ...existingUndated.metadata, done: false } }
        : i,
      ),
      roots: getRoots(),
    }, [occ.fileSlug])
  } else {
    const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
      date:     '',
      time:     null,
      source:   'explicit',
      fileSlug: occ.fileSlug,
      id:       crypto.randomUUID(),
      metadata: { ...occFromAppMeta(occ.metadata), done: false },
    }
    commitNext({ items: [...allItems, newOcc], roots: getRoots() }, [occ.fileSlug])
  }
}

export function beginSwipeDelete(o: Occurrence): () => void {
  const snapshot = getSnapshot()
  const title    = o.metadata.title
  let cancelled  = false

  if (occIsRecur(o)) {
    const next = excludeOccurrence(snapshot, o)
    const endsSeries = deletionEndsAfterCompletionSeries(snapshot.items, o)
    showDeleteToast(title,
      () => { writeEntity(o.fileSlug) },
      () => { cancelled = true; restoreFileSlug(snapshot, o.fileSlug) },
      { endsSeries },
    )
    return () => { if (!cancelled) setData(next) }
  } else {
    showDeleteToast(title,
      () => { deleteEntity(o.fileSlug) },
      () => {
        cancelled = true
        if (!getItems().find(i => i.id === o.id)) restoreFileSlug(snapshot, o.fileSlug)
      },
    )
    return () => {
      if (!cancelled) setData(deleteByFileSlug(getSnapshot(), o.fileSlug))
    }
  }
}

