import { useStore } from '@/store'
import { addDays } from '@/format'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useCalendarFilter } from './useCalendarFilter'
import { computeAgendaSections, type AgendaSectionCache, type AgendaRow } from './agendaSections'

export { estimateRow, type AgendaRow } from './agendaSections'

// Asymmetric on purpose: overdue tasks can be arbitrarily old (see the fix
// that expanded this from 7 to 365 days so old tasks would still surface in
// the overdue section), but the agenda itself is a near-term view — planning
// further ahead than a season ahead belongs in month view, not an infinitely
// scrolling list.
const PAST_WINDOW_DAYS = 365
const FUTURE_WINDOW_DAYS = 90

// The agenda is a singleton view (only one instance mounted at a time), so a
// single cache slot — unlike useExpandWithMultiday's per-window map, which
// has to serve several concurrent callers (month's three panes, day's
// carousel) — is enough here. Stored as a one-entry Map, not a `let` or a
// plain object's `.current` field: the React Compiler's purity check
// (react-hooks/immutability / react-hooks/globals) flags both reassigning a
// module binding during render and writing a property on one, but a method
// call like Map.set() on a const-bound object is the same pattern
// useExpandWithMultiday's cacheByWindow already uses, and passes.
const SECTIONS_CACHE_KEY = 'agenda'
const sectionsCacheSlot = new Map<typeof SECTIONS_CACHE_KEY, AgendaSectionCache>()

/** Drops the cached grouped/sorted sections. Call on vault change (see resetExpansionCache). */
export function resetAgendaSectionsCache(): void {
  sectionsCacheSlot.clear()
}

/**
 * The agenda's data pipeline: expand occurrences over the agenda window, then
 * group by day, filter, sort, and flatten into one ordered list of
 * virtualizable rows (past days → overdue → current/future days, each a
 * header row followed by its occurrence rows).
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
 * (`[anchor - PAST_WINDOW_DAYS, anchor + FUTURE_WINDOW_DAYS]`) — see
 * calendar/viewState.ts's agendaAnchor for why AgendaView passes something
 * else after a jump from Month/Day.
 */
export function useAgendaSections(
  today: Date,
  now: Date,
  anchor: Date = today,
): { rows: AgendaRow[]; goToRowIndex: number } {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const from = addDays(anchor, -PAST_WINDOW_DAYS)
  const to = addDays(anchor, FUTURE_WINDOW_DAYS)
  const allOccs = useExpandWithMultiday(items, roots, from, to)
  const { filterOccs } = useCalendarFilter()

  // now ticks once a minute (see useNow), but a remounted AgendaView
  // allocates a fresh Date even within the same tick — bucket to that same
  // granularity before it reaches computeAgendaSections' exact-match check,
  // so a remount within the same minute still hits the fully-cached fast
  // path instead of missing on nowMs alone.
  const nowBucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000)

  const cached = sectionsCacheSlot.get(SECTIONS_CACHE_KEY) ?? null
  const next = computeAgendaSections(cached, allOccs, today, nowBucket, filterOccs, anchor)
  if (next !== cached) {
    sectionsCacheSlot.set(SECTIONS_CACHE_KEY, next)
  }

  return { rows: next.rows, goToRowIndex: next.goToRowIndex }
}
