import { useState } from 'react'

/**
 * Keeps a row rendered, in the place it already occupied, after the data it
 * came from has dropped it — long enough for the row to play a leave animation.
 *
 * A leave is the one list change React cannot express on its own: by the time
 * the store says the row is gone it is already unmounted, and an unmounted row
 * cannot animate. So the row has to be retained here and re-inserted into the
 * rendered list until it says it is done (`endLeave`).
 *
 * **Retained in place, and by identity.** The row is spliced back at the index
 * it held when it left, under the same key, so React reuses the element it
 * already has rather than mounting a fresh one. That is what lets a CSS
 * transition run at all — a newly mounted element has no previous value to
 * transition *from* — and it also keeps whatever local state the row was
 * carrying (an optimistically ticked checkbox, say) instead of resetting it to
 * whatever the pre-removal snapshot said.
 */
interface LeavingRow<T, K> {
  item: T
  key: K
  leaving: boolean
}

export function useLeavingRows<T, K>(current: readonly T[], keyOf: (item: T) => K) {
  const [leaving, setLeaving] = useState<{ item: T; key: K; at: number }[]>([])

  const endLeave = (key: K) => {
    setLeaving(prev => prev.filter(l => l.key !== key))
  }

  // A row that is still in `current` is dropped from there rather than from the
  // retained set: rendering both copies would put the same key on screen twice,
  // which React reads as a duplicate rather than as one row mid-exit. This also
  // covers a row that never actually left (a leave begun against a row the data
  // then kept) — it stays retained, and the collapse's own timeout releases it.
  const held = new Set(leaving.map(l => l.key))
  const rows: LeavingRow<T, K>[] = current
    .filter(item => !held.has(keyOf(item)))
    .map(item => ({ item, key: keyOf(item), leaving: false }))

  // Ascending, so each splice lands before the ones still to be placed can
  // shift it — the indices below are positions in this same merged list.
  for (const { item, key, at } of [...leaving].sort((a, b) => a.at - b.at)) {
    rows.splice(Math.min(at, rows.length), 0, { item, key, leaving: true })
  }

  /**
   * Call while `item` is still on screen — the place it is holding right now is
   * the one it will be put back at.
   *
   * The index recorded is its position in the *rendered* list, retained rows
   * included, not in `current`. A second row leaving while a first is still
   * collapsing would otherwise record an index measured against a list one row
   * shorter than the one it gets spliced back into, and land ahead of the rows
   * it should follow.
   */
  const beginLeave = (item: T) => {
    const key = keyOf(item)
    const at = rows.findIndex(r => r.key === key)
    if (at < 0) return
    setLeaving(prev => prev.some(l => l.key === key) ? prev : [...prev, { item, key, at }])
  }

  return { rows, beginLeave, endLeave, anyLeaving: leaving.length > 0 }
}
