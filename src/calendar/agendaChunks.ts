import { addDays, differenceInCalendarDays, startOfDay } from 'date-fns'
import { dayRange } from '@/model'
import { weekStartFor } from './weekRange'

/**
 * The agenda's absolute chunk grid — pure date math, no React, no cache.
 *
 * A chunk is a fixed 28-day span, keyed by an index derived from the epoch and
 * aligned to week starts (28 = 4 × 7, so any grid anchored on a week start
 * keeps every chunk boundary on one too). Chunk-local sectioning rests on that
 * alignment: whether a chunk's first day opens a new week or month divider is
 * a pure function of the chunk index — no data, no neighbouring chunk. See
 * agendaSections.ts's walkChunk.
 *
 * Deliberately anchored to the epoch rather than to `agendaAnchor`: an
 * anchor-relative grid would shift its whole numbering whenever the anchor
 * moves (e.g. a jump in from Month/Day view), which discards every cached
 * chunk exactly like the single-window cache it replaces. An absolute grid
 * means a jump reuses every chunk whose range still overlaps the new window.
 */
export const CHUNK_DAYS = 28

/**
 * The agenda's window, `[anchor - EXPAND_PAST_DAYS, anchor +
 * EXPAND_FUTURE_DAYS]`, rounded out to whole chunks by `agendaChunkRun`.
 *
 * Asymmetric on purpose: the agenda is a near-term view, and planning further
 * ahead than a season belongs in month view rather than in an endlessly
 * scrolling list. It reaches further back because a scrolled-past day is
 * cheaper to keep than to explain, *not* because overdue work lives there —
 * that is overduePool.ts's OVERDUE_LOOKBACK_DAYS, which is a separate number
 * with a separate reason to change.
 *
 * There used to be a third pair, WALK_PAST_DAYS/WALK_FUTURE_DAYS, for the
 * day-by-day render walk, plus a test asserting the expansion covered it — a
 * day the walk visited but the expansion never reached rendered empty,
 * silently. The walk now covers exactly the chunks that were expanded (see
 * agendaSections.ts's computeChunkRows, which walks one chunk's own 28 days),
 * so that relationship holds structurally and the pair is gone.
 */
export const EXPAND_PAST_DAYS = 365
export const EXPAND_FUTURE_DAYS = 90

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

/**
 * The run of chunks the agenda expands *and* walks for `anchor` — the window
 * above, rounded out to whole chunks.
 *
 * Rounding out rather than clipping the first/last chunk is what keeps a
 * chunk's rows a pure function of its own index: a partially-walked chunk's
 * dividers and day rows would depend on where the window happened to start,
 * so the two chunks at the run's edges would be rebuilt on every anchor move.
 * The cost is up to 27 extra days of ruler at each end, which the agenda
 * renders as it renders any other empty stretch.
 */
export function agendaChunkRun(anchor: Date, ws: 0 | 1 | 6): number[] {
  return chunkIndicesFor(addDays(anchor, -EXPAND_PAST_DAYS), addDays(anchor, EXPAND_FUTURE_DAYS), ws)
}

/** Every chunk index whose range overlaps `[from, to]`, ascending. */
export function chunkIndicesFor(from: Date, to: Date, ws: 0 | 1 | 6): number[] {
  const start = chunkIndexFor(from, ws)
  const end = chunkIndexFor(to, ws)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}
