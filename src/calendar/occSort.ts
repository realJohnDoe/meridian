import { parseDurationDays, fmtT } from '@/model'
import type { Occurrence } from '@/types'
import { occKind, occState } from '@/occView'

const _prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

export function isDimmed(o: Occurrence): boolean {
  const state = occState(o)
  return state === 'done' || state === 'event-past'
}

export function priorityRank(priority: string | undefined): number {
  return priority ? (_prioOrder[priority] ?? 3) : 3
}

function _sortKey(o: Occurrence): number {
  // Active items first (groups 0-3), sorted by type; dimmed (done/past)
  // items all collapse into a single trailing group (4) and are then
  // sorted alphabetically by title — see sortOccs below.
  if (isDimmed(o)) return 4
  const isEvent    = occKind(o) === 'event'
  const isMultiday = (parseDurationDays(o.metadata.duration) ?? 0) >= 2
  const hasTimed   = !!fmtT(o.time)

  if (isEvent && isMultiday) return 0   // multiday events
  if (isEvent && !hasTimed)  return 1   // untimed single-day events
  if (isEvent &&  hasTimed)  return 2   // timed events
  return 3                              // tasks
}

function _prioKey(o: Occurrence): number {
  return priorityRank(o.metadata.priority)
}

export function sortOccs(arr: Occurrence[]): Occurrence[] {
  return [...arr].sort((a: Occurrence, b: Occurrence) => {
    const sd = _sortKey(a) - _sortKey(b); if (sd) return sd
    if (isDimmed(a) && isDimmed(b))
      return (a.metadata.title || '').localeCompare(b.metadata.title || '')
    const pd = _prioKey(a) - _prioKey(b); if (pd) return pd
    const ta = a.metadata.jsTime?.getTime() ?? 0
    const tb = b.metadata.jsTime?.getTime() ?? 0
    if (ta !== tb) return ta - tb
    return (a.metadata.title || '').localeCompare(b.metadata.title || '')
  })
}
