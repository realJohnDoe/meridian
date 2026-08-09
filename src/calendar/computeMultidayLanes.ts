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

/**
 * Maps the (possibly sparse) global lanes of the bars intersecting one week
 * row to consecutive display lanes 0..n-1, preserving relative order. Global
 * lane assignment (computeMultidayLanes above) keeps an event's lane fixed
 * across every row it spans, which can leave a row's own lanes sparse — e.g.
 * an event pushed to lane 5 by five others sits alone there for weeks after
 * they've all ended, with lanes 0-4 blank in every one of those rows. This
 * compacts what's actually present in a row onto a dense range so it renders
 * without blank lanes, while a bar spanning multiple rows only shifts when
 * something above it in THIS row actually starts or ends, not arbitrarily.
 */
export function compactRowLanes(lanes: number[]): Map<number, number> {
  const distinct = [...new Set(lanes)].sort((a, b) => a - b)
  return new Map(distinct.map((lane, i) => [lane, i]))
}

/**
 * How many (already-compacted) lanes a week row may paint. All of them when
 * they fit within maxVisible — the number of row-height slots the cell has
 * room for, shared with single-day occurrence rows (see MonthGrid/CalCell).
 * When they don't fit, one fewer than maxVisible, so CalCell's own overflow
 * marker — which occupies one of those same slots, see its `capacity` calc —
 * has a slot to render in rather than being pushed below the cell's clipped
 * height. Multiday events are still capped here, since display (unlike the
 * lane model) can't paint more full-height bars than physically fit, but the
 * excess folds into each affected day's own "+N" via hiddenBarCount rather
 * than disappearing silently — never displaced by single-day items.
 */
export function visibleLaneCount(rowLaneCount: number, maxVisible: number): number {
  if (rowLaneCount <= maxVisible) return rowLaneCount
  return Math.max(0, maxVisible - 1)
}
