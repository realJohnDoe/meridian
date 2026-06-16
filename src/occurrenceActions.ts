import {
  toggleDone, excludeOccurrence, deleteByFileSlug,
} from './model/storeOps'
import { occIsRecur } from './types'
import type { Occurrence } from './types'
import { getItems, getRoots, setData } from './storeBridge'
import { warmSlugInFOM } from './presentation'
import { writeEntityToCache, deleteFromBackend } from './storage/sync'
import { showDeleteToast } from './undoToast'

export function toggleOccDone(o: Occurrence): void {
  const next = toggleDone({ items: getItems(), roots: getRoots() }, o)
  warmSlugInFOM(o.fileSlug, next.items, next.roots)
  setData(next)
  writeEntityToCache(o.fileSlug)
}

export function beginSwipeDelete(o: Occurrence): () => void {
  const snapshot = { items: getItems(), roots: getRoots() }
  const title    = o.metadata.title
  let cancelled  = false

  if (occIsRecur(o)) {
    const next = excludeOccurrence(snapshot, o)
    showDeleteToast(title,
      () => { writeEntityToCache(o.fileSlug) },
      () => { cancelled = true; setData(snapshot) },
    )
    return () => { if (!cancelled) setData(next) }
  } else {
    showDeleteToast(title,
      () => { deleteFromBackend(o.fileSlug) },
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

