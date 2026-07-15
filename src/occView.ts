import { startOfDay } from 'date-fns'
import { parseDurationDays, parseDurationHours } from '@/model'
import type { Occurrence, OccState } from './types'

/** Derive the display kind from occurrence data. */
export function occKind(occ: Occurrence): 'event' | 'task' | 'note' {
  return occ.metadata.done !== undefined ? 'task' : occ.date ? 'event' : 'note'
}

/** True when the occurrence belongs to a recurring series (has an ownerId). */
export function occIsRecur(occ: Occurrence): boolean {
  return !!occ.ownerId
}

/**
 * `now` defaults to the wall clock for callers that don't have a live-updating
 * value on hand (sorting, one-off renders). Components that stay mounted
 * across time (e.g. OccurrenceCard in the agenda) should pass an explicit,
 * externally-refreshed `now` instead, so this stays a pure function of its
 * arguments and can be safely memoized by the caller.
 */
export function occState(o: Occurrence, now: Date = new Date()): OccState {
  if (o.metadata.done) return 'done'
  const kind = occKind(o)
  if (kind === 'note') return 'note'
  if (kind === 'task' || o.metadata.done !== undefined) {
    const p = o.metadata.priority
    if (p === 'high')   return 'task-p1'
    if (p === 'medium') return 'task-p2'
    if (p === 'low')    return 'task-p3'
    return 'task-open'
  }
  const today = startOfDay(now)
  if ((parseDurationDays(o.metadata.duration) ?? 0) >= 2) {
    // Use day-level comparison: past days of a multiday event get the gray shader,
    // today and future days stay purple.
    if (o.metadata.jsTime) {
      const day = startOfDay(o.metadata.jsTime)
      if (day < today) return 'event-past'
    }
    return 'event-future'
  }
  if (o.metadata.jsTime && o.metadata.jsTime < now) {
    // Whole-day events (no time) use day-level comparison — they stay colored
    // until midnight, not until 00:01 AM when jsTime (midnight) < now.
    if (!o.time) {
      const eventDay = startOfDay(o.metadata.jsTime)
      if (eventDay >= today) return 'event-future'
    } else if (o.metadata.duration) {
      // Timed event with explicit duration: still future while the event is ongoing.
      const endMs = o.metadata.jsTime.getTime() + parseDurationHours(o.metadata.duration) * 3_600_000
      if (endMs > now.getTime()) return 'event-future'
    }
    return 'event-past'
  }
  return 'event-future'
}
