import { useCallback, useMemo } from 'react'
import { useStore } from '@/store'
import { occKind } from '@/occView'
import type { Occurrence } from '@/types'

export const NO_PARTICIPANT = '__no_participant__'

/**
 * The "who" axis — the only filter that means the same thing on every view,
 * so it is shared by the calendar and the undated list views alike.
 */
export function filterByParticipants(occs: Occurrence[], filter: string[]): Occurrence[] {
  if (!filter.length) return occs
  return occs.filter(o => {
    const ps = o.metadata.participants
    if (filter.includes(NO_PARTICIPANT) && ps.length === 0) return true
    return ps.some(p => filter.includes(p))
  })
}

export function useCalendarFilter() {
  const filter    = useStore(s => s.participantFilter)
  const showTasks = useStore(s => s.showTasks)

  const filterOccs = useCallback((occs: Occurrence[]) => {
    const byKind = showTasks ? occs : occs.filter(o => occKind(o) !== 'task')
    return filterByParticipants(byKind, filter)
  }, [filter, showTasks])

  return { filter, showTasks, filterOccs }
}

/**
 * Memoized wrapper around useCalendarFilter's filterOccs. filterOccs only
 * returns its input by reference when showTasks is on and no participant
 * filter is set — with either active, it allocates a new array every call,
 * so callers that feed the result into their own useMemo deps (e.g.
 * AgendaView's day grouping) would otherwise recompute on every render
 * whenever a filter is active.
 */
export function useFilteredOccs(occs: Occurrence[]): Occurrence[] {
  const { filterOccs } = useCalendarFilter()
  return useMemo(() => filterOccs(occs), [occs, filterOccs])
}

/**
 * Participant filtering for the undated list views (Backlog, Notes).
 *
 * Deliberately does *not* apply showTasks: that toggle composes the calendar,
 * and these views have already answered the kind question by existing —
 * Backlog is tasks-only, Notes is notes-only. Honouring showTasks here would
 * blank the entire Backlog whenever tasks are hidden on the calendar.
 */
export function useParticipantFilteredOccs(occs: Occurrence[]): Occurrence[] {
  const filter = useStore(s => s.participantFilter)
  return useMemo(() => filterByParticipants(occs, filter), [occs, filter])
}
