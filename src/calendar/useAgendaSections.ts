import { useStore } from '@/store'
import { addDays } from '@/format'
import { weekStartsOn, dayRange } from '@/model'
import { useAgendaChunks } from './useAgendaChunks'
import { useCalendarFilter } from './useCalendarFilter'
import { useOverdueCollapsed } from './viewState'
import {
  computeAgendaSections,
  type AgendaRow,
} from './agendaSections'
import { computeOverduePool } from './overduePool'
import { SECTIONS_CACHE_KEY, sectionsCacheSlot, overduePoolSlot } from './expansionCaches'

export { estimateRow, type AgendaRow } from './agendaSections'

/**
 * The agenda's expansion window, `[anchor - EXPAND_PAST_DAYS, anchor +
 * EXPAND_FUTURE_DAYS]`.
 *
 * Separate from the day-by-day render walk's own span
 * (`WALK_PAST_DAYS`/`WALK_FUTURE_DAYS` in agendaSections.ts) and from the
 * overdue lookback (`OVERDUE_LOOKBACK_DAYS` in overduePool.ts), which the same
 * two constants used to mean all at once. The three have genuinely different
 * reasons to change — incremental loading narrows this one and leaves the other
 * two alone — so they are three names now, with the one relationship that has
 * to hold (this window must cover the walk) asserted in the tests rather than
 * enforced by sharing a literal.
 */
export const EXPAND_PAST_DAYS = 365
export const EXPAND_FUTURE_DAYS = 90

// The agenda is a singleton view (only one instance mounted at a time), so a
// single cache slot each for the grouped/sorted sections and the overdue pool
// — unlike useExpandWithMultiday's per-window map, which has to serve several
// concurrent callers (month's three panes, day's carousel) — is enough here.
// Both slots now live in expansionCaches.ts, alongside every other
// module-level cache in calendar/, so vault-change reset is one call
// (resetAll) instead of one hand-wired reset per cache — see that file's own
// doc comment.
/**
 * The agenda's data pipeline: expand occurrences over the agenda window, then
 * group by day, filter, sort, and flatten into one ordered list of
 * virtualizable rows — a continuous day-by-day walk of the window carrying
 * month/week divider rows, each day's own occurrence rows (badged on the
 * first), and the overdue toggle spliced in at the today/future boundary.
 *
 * Sections remain the *cache* unit inside computeAgendaSections — that's what
 * makes a single toggle rebuild one day instead of the whole vault — but they
 * aren't what AgendaView virtualizes. It counts `rows`, so an unbounded
 * section (notably overdue) can't mount thousands of components at once.
 *
 * Pulled out of AgendaView so this derivation — pure of the virtualizer, the
 * scroll listener, and the scroll-to-today effect — can be cached normally.
 * AgendaView itself carries a `'use no memo'` opt-out because of its
 * useVirtualizer() usage; that opt-out no longer reaches this logic.
 *
 * The grouping/sorting cache lives in the module-level `sectionsCacheSlot`
 * above, not component state: computeAgendaSections returns `prev` by
 * reference whenever nothing changed, and storing that at module scope means
 * remounting AgendaView (leaving and returning to the agenda, or a cold
 * start) reuses the prior grouping/sort instead of paying for it again from
 * scratch — component state would otherwise reset to null on every remount.
 *
 * The calendar filter is applied per day inside computeAgendaSections rather
 * than up front via useFilteredOccs: filtering the whole array first would
 * re-derive every day's membership on each toggle, which is exactly what the
 * cache exists to avoid.
 *
 * `today` and `now` are passed in rather than read here via useToday/useNow,
 * since AgendaView needs both for its own scroll-to-today and per-row
 * live-repaint logic too — one ticking source shared by both, not two.
 *
 * `anchor` defaults to `today` and centers the expansion window
 * (`[anchor - EXPAND_PAST_DAYS, anchor + EXPAND_FUTURE_DAYS]`) — see
 * calendar/viewState.ts's agendaAnchor for why AgendaView passes something
 * else after a jump from Month/Day.
 *
 * The overdue block is *not* derived from that window: it runs its own
 * expansion over a filtered item set and the full overdue lookback (see
 * overduePool.ts), so the two are invalidated independently and the agenda's
 * window no longer has to reach a year back on the overdue section's behalf.
 */
export function useAgendaSections(
  today: Date,
  now: Date,
  anchor: Date = today,
): { rows: AgendaRow[]; goToRowIndex: number } {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)
  const ws = weekStartsOn(useStore(s => s.localePrefs))

  // dayRange, not a bare addDays(anchor, EXPAND_FUTURE_DAYS): the latter lands
  // on midnight of the window's last day, and expandRange's inclusive [from,
  // to] filter would then silently drop any *timed* occurrence on that day.
  // See dayRange's own doc comment.
  const { from, to } = dayRange(addDays(anchor, -EXPAND_PAST_DAYS), addDays(anchor, EXPAND_FUTURE_DAYS))
  const allOccs = useAgendaChunks(items, roots, from, to, ws)
  const { filterOccs } = useCalendarFilter()
  const overdueCollapsed = useOverdueCollapsed()

  const cachedPool = overduePoolSlot.get(SECTIONS_CACHE_KEY) ?? null
  const pool = computeOverduePool(cachedPool, items, roots, today, filterOccs)
  if (pool !== cachedPool) {
    overduePoolSlot.set(SECTIONS_CACHE_KEY, pool)
  }

  // now ticks once a minute (see useNow), but a remounted AgendaView
  // allocates a fresh Date even within the same tick — bucket to that same
  // granularity before it reaches computeAgendaSections' exact-match check,
  // so a remount within the same minute still hits the fully-cached fast
  // path instead of missing on nowMs alone.
  const nowBucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000)

  const cached = sectionsCacheSlot.get(SECTIONS_CACHE_KEY) ?? null
  const next = computeAgendaSections(cached, allOccs, pool.groups, today, nowBucket, filterOccs, anchor, overdueCollapsed, ws)
  if (next !== cached) {
    sectionsCacheSlot.set(SECTIONS_CACHE_KEY, next)
  }

  return { rows: next.rows, goToRowIndex: next.goToRowIndex }
}
