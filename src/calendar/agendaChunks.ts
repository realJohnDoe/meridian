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
 * The bound on how far the agenda's *loaded run* may grow from
 * `agendaAnchor` — no longer the window itself. First paint seeds only three
 * chunks (the one containing the anchor, plus one on each side; see
 * `calendar/viewState.ts`'s `agendaLoadedChunks`), and the run then grows
 * incrementally: forward as the user scrolls, backward on the explicit "Load
 * earlier" action. These two constants are the ceiling on each direction of
 * that growth (see `minLoadableChunk`/`maxLoadableChunk` below), not a span
 * that gets expanded up front.
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
 * Every chunk index in `[first, last]` inclusive — turns the agenda's loaded
 * run (`calendar/viewState.ts`'s `agendaLoadedChunks`) into the index list
 * `useAgendaChunks` expands and `computeAgendaSections` walks.
 *
 * Deliberately pure: the loaded run itself is session-scoped state (it grows
 * with what the user has scrolled or asked for), so it can't be recomputed
 * from `anchor`/`ws` alone the way the old fixed ±window was. Callers read
 * the *current* run from `calendar/viewState.ts` (`useAgendaLoadedRun`, which
 * also seeds it around a fresh anchor) and pass it here.
 */
export function agendaChunkRun(range: { first: number; last: number }): number[] {
  const out: number[] = []
  for (let i = range.first; i <= range.last; i++) out.push(i)
  return out
}

/** How far back the loaded run may grow via "Load earlier" — see EXPAND_PAST_DAYS. */
export function minLoadableChunk(anchor: Date, ws: 0 | 1 | 6): number {
  return chunkIndexFor(addDays(anchor, -EXPAND_PAST_DAYS), ws)
}

/** How far forward the loaded run may grow as the user scrolls — see EXPAND_FUTURE_DAYS. */
export function maxLoadableChunk(anchor: Date, ws: 0 | 1 | 6): number {
  return chunkIndexFor(addDays(anchor, EXPAND_FUTURE_DAYS), ws)
}

/** Every chunk index whose range overlaps `[from, to]`, ascending. */
export function chunkIndicesFor(from: Date, to: Date, ws: 0 | 1 | 6): number[] {
  const start = chunkIndexFor(from, ws)
  const end = chunkIndexFor(to, ws)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}
