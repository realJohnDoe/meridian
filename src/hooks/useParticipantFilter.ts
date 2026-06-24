import { useCallback } from 'react'
import { useStore } from '@/store'
import type { Occurrence } from '@/types'

export const NO_PARTICIPANT = '__no_participant__'

export function useParticipantFilter() {
  const filter = useStore(s => s.participantFilter)

  const filterOccs = useCallback((occs: Occurrence[]) => {
    if (!filter.length) return occs
    return occs.filter(o => {
      const ps = o.metadata.participants
      if (filter.includes(NO_PARTICIPANT) && ps.length === 0) return true
      return ps.some(p => filter.includes(p))
    })
  }, [filter])

  return { filter, filterOccs }
}
