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
 * The ceiling on how far forward the agenda's *loaded run* may grow from
 * `agendaAnchor` — not a window expanded up front. First paint seeds only
 * three chunks (the one containing the anchor, plus one on each side; see
 * `calendar/viewState.ts`'s `agendaLoadedChunks`), and the run then grows
 * incrementally: forward as the user scrolls, backward on the explicit "Load
 * earlier" action.
 *
 * **Backward growth has no matching bound** — "Load earlier" reaches
 * arbitrarily far into the past, one chunk per press. Nothing is saved by
 * stopping it: `expandRange` seeks analytically from a series' anchor to the
 * query window rather than walking it (see `iterScheduledDates`' skip-ahead in
 * model/expansion.ts), so a chunk's cost is set by its own width, not by its
 * distance from today, and `MAX_LOADED_CHUNKS` caps what's held either way.
 *
 * Forward is bounded because the growth it feeds is automatic rather than
 * user-driven, and this constant is its **only termination condition**.
 * AgendaView's grow-forward effect re-runs on every `rows` change, including
 * the one growth itself causes; its "did this add anything?" guard compares
 * `rows.length`, and `walkChunk` emits week/month dividers unconditionally, so
 * even a chunk with nothing scheduled in it adds ~4-5 rows and the guard never
 * fires. Past the last occurrence a sparse tail also keeps the virtualizer's
 * range pinned to the end of `rows`, so the range check never fires either.
 * Remove this and the agenda walks itself into the far future, trimming real
 * content off the back edge as it goes. Stopping instead at the first chunk
 * with no occurrences doesn't work: an indefinite series (no `end`) puts a real
 * occurrence in every future chunk, forever.
 *
 * Neither bound is about where overdue work lives — that is `@/model`'s
 * OVERDUE_LOOKBACK_DAYS (read by overduePool.ts), a separate number with a
 * separate reason to change.
 *
 * There used to be a pair, WALK_PAST_DAYS/WALK_FUTURE_DAYS, for the day-by-day
 * render walk, plus a test asserting the expansion covered it — a day the walk
 * visited but the expansion never reached rendered empty, silently. The walk
 * now covers exactly the chunks that were expanded (see agendaSections.ts's
 * computeChunkRows, which walks one chunk's own 28 days), so that relationship
 * holds structurally and the pair is gone.
 */
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
