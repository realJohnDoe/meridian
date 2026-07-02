import { toggleDone, excludeOccurrence, deletionEndsAfterCompletionSeries, deleteByFileSlug } from '@/model'
import { occIsRecur } from './occView'
import type { Occurrence } from './types'
import { getItems, getRoots, setData } from './storeBridge'
import { writeEntity, deleteEntity } from './persistencePort'
import { commitNext } from './storeCommit'
import { showDeleteToast } from './undoToast'

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

