import {
  toggleDone, excludeOccurrence, deleteByFileSlug, moveOccToDate,
} from './model/storeOps'
import { occIsRecur, occKind } from './types'
import type { Occurrence } from './types'
import { getItems, getRoots, setData } from './storeBridge'
import { writeEntityToCache, deleteFromBackend } from './storage/sync'
import { commitNext } from './storeCommit'
import { showDeleteToast, showDoneMovedToast } from './undoToast'
import { fmtISO } from './model/dateUtils'

export function toggleOccDone(o: Occurrence): void {
  const newDone = !o.metadata.done
  const snapshot = { items: getItems(), roots: getRoots() }

  if (newDone && occKind(o) === 'task') {
    const today = fmtISO(new Date())
    const isWholeDay = !o.time && !!o.date
    const hasNoDate = !o.date

    if ((isWholeDay || hasNoDate) && o.date !== today) {
      const afterDone = toggleDone(snapshot, o)
      const afterMove = { items: moveOccToDate(afterDone.items, o, today), roots: afterDone.roots }

      commitNext(afterMove, [o.fileSlug])

      showDoneMovedToast(o.metadata.title, o.date, () => {
        commitNext(afterDone, [o.fileSlug])
      })
      return
    }
  }

  const next = toggleDone(snapshot, o)
  commitNext(next, [o.fileSlug])
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

