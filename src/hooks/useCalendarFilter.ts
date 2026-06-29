import { useCallback } from 'react'
import { useStore } from '@/store'
import { occKind } from '@/occView'
import type { Occurrence } from '@/types'

export const NO_PARTICIPANT = '__no_participant__'

export function useCalendarFilter() {
  const filter    = useStore(s => s.participantFilter)
  const showTasks = useStore(s => s.showTasks)

  const filterOccs = useCallback((occs: Occurrence[]) => {
    let result = occs
    if (!showTasks) result = result.filter(o => occKind(o) !== 'task')
    if (!filter.length) return result
    return result.filter(o => {
      const ps = o.metadata.participants
      if (filter.includes(NO_PARTICIPANT) && ps.length === 0) return true
      return ps.some(p => filter.includes(p))
    })
  }, [filter, showTasks])

  return { filter, showTasks, filterOccs }
}
