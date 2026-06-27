import { toggleDone, excludeOccurrence, deleteByFileSlug } from '@/model/storeOps'
import { occIsRecur } from './occView'
import type { Occurrence } from './types'
import { getItems, getRoots, setData } from './storeBridge'
import { writeEntityToCache, deleteFromBackend } from '@/storage'
import { commitNext } from './storeCommit'
import { showDeleteToast } from './undoToast'

export function toggleOccDone(o: Occurrence): void {
  const t0 = performance.now()
  const snapshot = { items: getItems(), roots: getRoots() }
  const next = toggleDone(snapshot, o)
  const tModel = performance.now()
  console.log(`[perf:toggle] model (toggleDone): ${(tModel - t0).toFixed(2)}ms`)
  commitNext(next, [o.fileSlug])
  const tSync = performance.now()
  console.log(`[perf:toggle] commitNext (setData+scheduleWrite): ${(tSync - tModel).toFixed(2)}ms | total sync: ${(tSync - t0).toFixed(2)}ms`)
  requestAnimationFrame(() => {
    console.log(`[perf:toggle] → time to first paint (sync + React render): ${(performance.now() - t0).toFixed(2)}ms`)
  })
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

