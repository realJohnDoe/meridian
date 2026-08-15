import { toast } from 'sonner'
import { toggleDone, excludeOccurrence, deletionEndsAfterCompletionSeries, deleteByEntryKey, occFromAppMeta } from '@/model'
import { occIsRecur } from './occView'
import { isStandaloneOcc } from './types'
import type { Occurrence, OccurrenceEntry, OccurrenceMetadata, Roots, StoreItem } from './types'
import type { EntryKey } from './fileIO'
import { getSnapshot, getItems, getRoots, setData } from './storeBridge'
import { writeEntity, deleteEntity } from './persistencePort'
import { commitNext } from './storeCommit'

let _toastId:       string | number | null = null
let _pendingCommit: (() => void) | null    = null
const TOAST_MS = 4000

// Restores each of `keys`' items/root from `snapshot` into the *current*
// store, rather than reverting the whole store — an edit made to another
// file while the undo toast was up must survive. The restored slugs are then
// re-persisted so the cache/backend agree with the reverted store.
//
// Takes a list rather than one key so a delete's backlink cleanup (see
// `deleteByEntryKey`'s `affectedKeys`) can be undone in the same call as the
// primary file — restoring only the primary key would put the deleted entry
// back while leaving every other file's wikilink to it stripped, which is the
// half of finding #7 that was specific to Undo (the missing persistence was
// the other half, fixed at the two `beginSwipeDelete` call sites below).
function restoreEntries(snapshot: { items: StoreItem[]; roots: Roots }, entryKeys: readonly EntryKey[]): void {
  const keys = new Set(entryKeys)
  const current = getSnapshot()
  const items = [
    ...current.items.filter(i => !keys.has(i.entryKey)),
    ...snapshot.items.filter(i => keys.has(i.entryKey)),
  ]
  const roots = new Map(current.roots)
  for (const key of keys) {
    const snapshotRoot = snapshot.roots.get(key)
    if (snapshotRoot) roots.set(key, snapshotRoot)
    else roots.delete(key)
  }
  setData({ items, roots })
  for (const key of keys) writeEntity(key)
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
  commitNext(next, [o.entryKey])
}

// Re-opens a done, undated occurrence: reuses an existing undated entry for
// the file if one exists, otherwise creates a fresh undated entry.
export function reopenOcc(occ: Occurrence): void {
  const allItems = getItems()
  const existingUndated = allItems.find(
    i => isStandaloneOcc(i) && i.entryKey === occ.entryKey && i.date === '',
  ) as OccurrenceEntry<OccurrenceMetadata> | undefined

  if (existingUndated) {
    commitNext({
      items: allItems.map(i => i.id === existingUndated.id
        ? { ...existingUndated, metadata: { ...existingUndated.metadata, done: false } }
        : i,
      ),
      roots: getRoots(),
    }, [occ.entryKey])
  } else {
    const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
      date:     '',
      time:     null,
      source:   'explicit',
      entryKey: occ.entryKey,
      id:       crypto.randomUUID(),
      metadata: { ...occFromAppMeta(occ.metadata), done: false },
    }
    commitNext({ items: [...allItems, newOcc], roots: getRoots() }, [occ.entryKey])
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
      () => { writeEntity(o.entryKey) },
      () => { cancelled = true; restoreEntries(snapshot, [o.entryKey]) },
      { endsSeries },
    )
    return () => { if (!cancelled) setData(next) }
  } else {
    // deleteByEntryKey's backlink cleanup — the OTHER files whose `items:`
    // list pointed at this one — is captured here so the deferred commit and
    // Undo (defined below, but not run until later: on toast auto-close, a
    // forced early commit from a second swipe-delete, or an Undo click) can
    // reach it without recomputing it from whatever the store happens to look
    // like when they fire. Genuinely unknown until apply() actually runs
    // (below): it recomputes from a FRESH snapshot, deliberately, so a
    // concurrent edit to some other file during the exit animation is not
    // silently reverted by writing back a stale one — see the identical
    // reasoning already governing `next` here for the recurring branch above.
    let affectedKeys: EntryKey[] = []
    showDeleteToast(title,
      () => { for (const key of affectedKeys) writeEntity(key); deleteEntity(o.entryKey) },
      () => {
        cancelled = true
        if (!getItems().find(i => i.id === o.id)) restoreEntries(snapshot, [o.entryKey, ...affectedKeys])
      },
    )
    return () => {
      if (cancelled) return
      const { data, affectedKeys: computed } = deleteByEntryKey(getSnapshot(), o.entryKey)
      affectedKeys = computed
      setData(data)
    }
  }
}

