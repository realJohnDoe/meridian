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

function _sortKey(o: Occurrence, now: Date): number {
  // Active items first (groups 0-3), sorted by type; dimmed (done/past)
  // items all collapse into a single trailing group (4) and are then
  // sorted alphabetically by title — see sortOccs below.
  if (isDimmed(o, now)) return 4
  const isEvent    = occKind(o) === 'event'
  const isMultiday = (parseDurationDays(o.metadata.duration) ?? 0) >= 2
  const hasTimed   = !!fmtT(o.time)

  if (isEvent && isMultiday) return 0   // multiday events
  if (isEvent && !hasTimed)  return 1   // untimed single-day events
  if (isEvent &&  hasTimed)  return 2   // timed events
  return 3                              // tasks
}

// Within the dimmed (done/past) group, cluster by kind before alphabetizing.
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
 */
export function sortOccs(arr: Occurrence[], now: Date): Occurrence[] {
  const decorated = arr.map(occ => ({
    occ,
    sortKey:   _sortKey(occ, now),
    prioKey:   priorityRank(occ.metadata.priority),
    kindOrder: doneKindOrder(occKind(occ)),
    jsTimeMs:  occ.metadata.jsTime?.getTime() ?? 0,
    title:     occ.metadata.title || '',
  }))

  decorated.sort((a, b) => {
    const sd = a.sortKey - b.sortKey; if (sd) return sd
    if (a.sortKey === 4) {
      // Both dimmed (sortKey 4 is only ever assigned via isDimmed above).
      const kd = a.kindOrder - b.kindOrder; if (kd) return kd
      return a.title.localeCompare(b.title)
    }
    const pd = a.prioKey - b.prioKey; if (pd) return pd
    if (a.jsTimeMs !== b.jsTimeMs) return a.jsTimeMs - b.jsTimeMs
    return a.title.localeCompare(b.title)
  })

  return decorated.map(d => d.occ)
}
