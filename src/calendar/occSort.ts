import { parseDurationDays, fmtT } from '@/model'
import type { Occurrence } from '@/types'
import { occKind, occState } from '@/occView'

const _prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }

function _sortKey(o: Occurrence): number {
  const state      = occState(o)
  const dimmed     = state === 'done' || state === 'event-past'
  const isEvent    = occKind(o) === 'event'
  const isMultiday = (parseDurationDays(o.metadata.duration) ?? 0) >= 2
  const hasTimed   = !!fmtT(o.time)

  // Active items first (groups 0-3), then past/done in the same sub-order (4-7)
  const base = dimmed ? 4 : 0
  if (isEvent && isMultiday) return base + 0   // multiday events
  if (isEvent && !hasTimed)  return base + 1   // untimed single-day events
  if (isEvent &&  hasTimed)  return base + 2   // timed events
  return base + 3                              // tasks
}

function _prioKey(o: Occurrence): number {
  return o.metadata.priority ? (_prioOrder[o.metadata.priority] ?? 3) : 3
}

export function sortOccs(arr: Occurrence[]): Occurrence[] {
  return [...arr].sort((a: Occurrence, b: Occurrence) => {
    const sd = _sortKey(a) - _sortKey(b); if (sd) return sd
    const pd = _prioKey(a) - _prioKey(b); if (pd) return pd
    const ta = a.metadata.jsTime?.getTime() ?? 0
    const tb = b.metadata.jsTime?.getTime() ?? 0
    if (ta !== tb) return ta - tb
    return (a.metadata.title || '').localeCompare(b.metadata.title || '')
  })
}
