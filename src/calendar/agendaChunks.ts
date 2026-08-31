import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import { dayRange } from '@/model'
import { weekStartFor } from './weekRange'

/**
 * The agenda's absolute chunk grid — pure date math, no React, no cache.
 *
 * A chunk is a fixed 28-day span, keyed by an index derived from the epoch and
 * aligned to week starts (28 = 4 × 7, so any grid anchored on a week start
 * keeps every chunk boundary on one too — PR 3's chunk-local sectioning
 * depends on this: whether a chunk's first day opens a new week/month divider
 * becomes a pure function of the chunk index, no neighbouring chunk needed).
 *
 * Deliberately anchored to the epoch rather than to `agendaAnchor`: an
 * anchor-relative grid would shift its whole numbering whenever the anchor
 * moves (e.g. a jump in from Month/Day view), which discards every cached
 * chunk exactly like the single-window cache it replaces. An absolute grid
 * means a jump reuses every chunk whose range still overlaps the new window.
 */
export const CHUNK_DAYS = 28

/**
 * The week start containing the Unix epoch, per locale week-start `ws` — the
 * grid's fixed origin. Only `ws` can move it, never `agendaAnchor`.
 */
function gridOrigin(ws: 0 | 1 | 6): Date {
  return weekStartFor(new Date(1970, 0, 1), ws)
}

/** The index of the chunk containing `date`. */
export function chunkIndexFor(date: Date, ws: 0 | 1 | 6): number {
  const days = differenceInCalendarDays(startOfDay(date), gridOrigin(ws))
  return Math.floor(days / CHUNK_DAYS)
}

/**
 * The inclusive `{ from, to }` bound of chunk `index`, built with `dayRange`
 * (not a bare midnight `to`) so a timed occurrence on the chunk's last day
 * isn't silently dropped by `expandRange`'s inclusive filter. Chunk `i`'s last
 * day is the day before chunk `i + 1`'s first — adjacent, no gap, no overlap.
 */
export function chunkRange(index: number, ws: 0 | 1 | 6): { from: Date; to: Date } {
  const firstDay = addDays(gridOrigin(ws), index * CHUNK_DAYS)
  const lastDay = addDays(firstDay, CHUNK_DAYS - 1)
  return dayRange(firstDay, lastDay)
}

/** Every chunk index whose range overlaps `[from, to]`, ascending. */
export function chunkIndicesFor(from: Date, to: Date, ws: 0 | 1 | 6): number[] {
  const start = chunkIndexFor(from, ws)
  const end = chunkIndexFor(to, ws)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}
