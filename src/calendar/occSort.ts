import { parseDurationDays, fmtT } from '@/model'
import type { Occurrence } from '@/types'
import { occKind, occState } from '@/occView'

const _prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

/**
 * `now` defaults to the wall clock for callers with no live-updating value on
 * hand (ItemsList's done/active partition) — see occState's own doc comment
 * for why that's fine there. sortOccs (below) always passes an explicit
 * value instead, since it's the one call site that used to read the clock
 * internally and broke callers who needed a memo-safe, dependency-tracked
 * sort (see AgendaView).
 */
export function isDimmed(o: Occurrence, now: Date = new Date()): boolean {
  const state = occState(o, now)
  return state === 'done' || state === 'event-past'
}

export function priorityRank(priority: string | undefined): number {
  return priority ? (_prioOrder[priority] ?? 3) : 3
}

// Type sub-order (0-3) within a dimmed/active bucket — see sortOccs below,
// which applies it identically to both so the two buckets read the same way.
function _typeKey(o: Occurrence): number {
  const isEvent    = occKind(o) === 'event'
  const isMultiday = (parseDurationDays(o.metadata.duration) ?? 0) >= 2
  const hasTimed   = !!fmtT(o.time)

  if (isEvent && isMultiday) return 0   // multiday events
  if (isEvent && !hasTimed)  return 1   // untimed single-day events
  if (isEvent &&  hasTimed)  return 2   // timed events
  return 3                              // tasks
}

// Used only by ItemsList's own sort (a different context: it interleaves
// occurrences with plain checklist-text entries that have no type/priority/
// time to sort by) — sortOccs below no longer needs it, now that its dimmed
// bucket is sorted the same way as its active one.
export function doneKindOrder(k: 'note' | 'event' | 'task'): number {
  return k === 'note' ? 0 : k === 'event' ? 1 : 2
}

/**
 * `now` is required and must be a value the caller can honestly stand behind
 * (a ticking clock, or a provably clock-independent placeholder — see the
 * call sites in BacklogView/NotesView). It used to default to `new Date()`
 * internally via isDimmed→occState, which made this function impure and
 * forced its callers into a phantom memo dependency (see AgendaView's
 * history) just to force a periodic re-sort.
 *
 * Decorates each item with its sort keys up front (one occState/occKind/
 * parseDuration pass per item) instead of recomputing them inside the
 * comparator on every pairwise comparison (~2·n·log n calls otherwise).
 *
 * Total order: active (open/future) items first, then dimmed (done/past)
 * ones — but *within* each of those two buckets, the same rule applies:
 * type, then priority, then time, then title. A done task keeps the spot
 * its priority/time would give it among other done items, rather than
 * being demoted to an alphabetical afterthought.
 */
export function sortOccs(arr: Occurrence[], now: Date): Occurrence[] {
  const decorated = arr.map(occ => ({
    occ,
    dimmedBucket: isDimmed(occ, now) ? 1 : 0,
    typeKey:   _typeKey(occ),
    prioKey:   priorityRank(occ.metadata.priority),
    jsTimeMs:  occ.metadata.jsTime?.getTime() ?? 0,
    title:     occ.metadata.title || '',
  }))

  decorated.sort((a, b) => {
    const bd = a.dimmedBucket - b.dimmedBucket; if (bd) return bd
    const td = a.typeKey - b.typeKey; if (td) return td
    const pd = a.prioKey - b.prioKey; if (pd) return pd
    if (a.jsTimeMs !== b.jsTimeMs) return a.jsTimeMs - b.jsTimeMs
    return a.title.localeCompare(b.title)
  })

  return decorated.map(d => d.occ)
}
