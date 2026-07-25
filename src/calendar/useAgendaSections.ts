import { useState } from 'react'
import { useStore } from '@/store'
import { addDays } from '@/format'
import { useExpandWithMultiday } from './useExpandWithMultiday'
import { useCalendarFilter } from './useCalendarFilter'
import { computeAgendaSections, type AgendaSectionCache, type Section } from './agendaSections'

export { estimateSection, type Section } from './agendaSections'

// Asymmetric on purpose: overdue tasks can be arbitrarily old (see the fix
// that expanded this from 7 to 365 days so old tasks would still surface in
// the overdue section), but the agenda itself is a near-term view — planning
// further ahead than a season ahead belongs in month view, not an infinitely
// scrolling list.
const PAST_WINDOW_DAYS = 365
const FUTURE_WINDOW_DAYS = 90

/**
 * The agenda's data pipeline: expand occurrences over the agenda window, then
 * group by day, filter, sort, and flatten into one ordered list of
 * virtualizable sections (past days → overdue → current/future days).
 *
 * Pulled out of AgendaView so this derivation — pure of the virtualizer, the
 * scroll listener, and the scroll-to-today effect — can be cached normally.
 * AgendaView itself carries a `'use no memo'` opt-out because of its
 * useVirtualizer() usage; that opt-out no longer reaches this logic.
 *
 * The grouping/sorting cache lives in state rather than a ref (mirroring
 * useExpandWithMultiday): computeAgendaSections returns `prev` by reference
 * whenever nothing changed, so gating the state update on that keeps the
 * during-render setState to genuine changes — and the immediate re-render it
 * triggers hits computeAgendaSections' O(1) fast path.
 *
 * The calendar filter is applied per day inside computeAgendaSections rather
 * than up front via useFilteredOccs: filtering the whole array first would
 * re-derive every day's membership on each toggle, which is exactly what the
 * cache exists to avoid.
 *
 * `today` and `now` are passed in rather than read here via useToday/useNow,
 * since AgendaView needs both for its own scroll-to-today and per-row
 * live-repaint logic too — one ticking source shared by both, not two.
 */
export function useAgendaSections(today: Date, now: Date): { sections: Section[]; goToIndex: number } {
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const from = addDays(today, -PAST_WINDOW_DAYS)
  const to = addDays(today, FUTURE_WINDOW_DAYS)
  const allOccs = useExpandWithMultiday(items, roots, from, to)
  const { filterOccs } = useCalendarFilter()

  const [cache, setCache] = useState<AgendaSectionCache | null>(null)
  const next = computeAgendaSections(cache, allOccs, today, now, filterOccs)
  if (next !== cache) {
    setCache(next)
  }

  return { sections: next.sections, goToIndex: next.goToIndex }
}
