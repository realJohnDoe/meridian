import { parseDurationHours } from '@/model'
import type { Occurrence } from '@/types'

export interface LayoutEvent { occ: Occurrence; dh: number; endMs: number; colIndex: number; totalCols: number }

/**
 * Greedy column-packing: returns columns of layout-annotated events.
 *
 * Events are first split into collision clusters — maximal runs (in start
 * order) where each event starts before the running max end time seen so
 * far in the run. Two events in different clusters can never overlap, so
 * each cluster is packed independently and each event's `totalCols`
 * reflects only the width its own cluster actually needs — not every
 * collision elsewhere in the day. (A cluster boundary means every packed
 * column is free again by construction, so clusters can reuse column
 * indices 0.. without colliding physically — see the merge step below.)
 */
export function computeColumns(events: Occurrence[]): LayoutEvent[][] {
  const sorted = [...events]
    .sort((a, b) => +(a.metadata.jsTime ?? 0) - +(b.metadata.jsTime ?? 0))
    .map(occ => {
      const dh = parseDurationHours(occ.metadata.duration)
      return { occ, dh, endMs: (occ.metadata.jsTime?.getTime() ?? 0) + dh * 3_600_000 }
    })

  const clusters: (typeof sorted)[] = []
  let clusterMaxEnd = -Infinity
  for (const ev of sorted) {
    const start = ev.occ.metadata.jsTime?.getTime() ?? 0
    if (clusters.length === 0 || start >= clusterMaxEnd) {
      clusters.push([])
      clusterMaxEnd = -Infinity
    }
    clusters[clusters.length - 1]!.push(ev)
    clusterMaxEnd = Math.max(clusterMaxEnd, ev.endMs)
  }

  const cols: LayoutEvent[][] = []
  for (const cluster of clusters) {
    const clusterCols: (typeof sorted)[] = []
    for (const ev of cluster) {
      let placed = false
      for (const col of clusterCols) {
        // Columns are only ever created as [ev], so they are never empty.
        if ((ev.occ.metadata.jsTime?.getTime() ?? 0) >= col[col.length - 1]!.endMs) {
          col.push(ev); placed = true; break
        }
      }
      if (!placed) clusterCols.push([ev])
    }
    const totalCols = clusterCols.length
    clusterCols.forEach((col, ci) => {
      cols[ci] ??= []
      for (const ev of col) cols[ci].push({ ...ev, colIndex: ci, totalCols })
    })
  }
  return cols
}
