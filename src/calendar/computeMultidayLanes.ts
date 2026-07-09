import { addDays, startOfDay } from 'date-fns'
import { parseDurationDays, parseDateString } from '@/model'
import type { Occurrence } from '@/types'

export interface MultidayLane {
  occ:    Occurrence
  startD: Date
  endD:   Date
  lane:   number
}

/**
 * Greedily assigns a lane index to each multi-day occurrence by global date
 * overlap (not per-week-row), so an event spanning several weeks keeps the
 * same lane in every row it's projected into instead of jumping lanes at
 * week boundaries.
 */
export function computeMultidayLanes(occs: Occurrence[]): MultidayLane[] {
  const withRange = occs
    .map(occ => {
      const parsed = parseDateString(occ.date)
      const startD = startOfDay(parsed ?? new Date(occ.date))
      const days = parseDurationDays(occ.metadata.duration) ?? 1
      const endD = addDays(startD, days - 1)
      return { occ, startD, endD }
    })
    .sort((a, b) =>
      a.startD.getTime() - b.startD.getTime() ||
      (b.endD.getTime() - b.startD.getTime()) - (a.endD.getTime() - a.startD.getTime()),
    )

  const laneEndMs: number[] = []
  return withRange.map(item => {
    let lane = laneEndMs.findIndex(end => end < item.startD.getTime())
    if (lane === -1) {
      lane = laneEndMs.length
      laneEndMs.push(item.endD.getTime())
    } else {
      laneEndMs[lane] = item.endD.getTime()
    }
    return { ...item, lane }
  })
}
