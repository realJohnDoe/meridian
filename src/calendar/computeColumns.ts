import { parseDurationHours } from '@/model'
import type { Occurrence } from '@/types'

export interface LayoutEvent { occ: Occurrence; dh: number; endMs: number }

/** Greedy column-packing: returns columns of layout-annotated events. */
export function computeColumns(events: Occurrence[]): LayoutEvent[][] {
  const sorted = [...events]
    .sort((a, b) => +(a.metadata.jsTime ?? 0) - +(b.metadata.jsTime ?? 0))
    .map<LayoutEvent>(occ => {
      const dh = parseDurationHours(occ.metadata.duration)
      return { occ, dh, endMs: (occ.metadata.jsTime?.getTime() ?? 0) + dh * 3_600_000 }
    })
  const cols: LayoutEvent[][] = []
  for (const ev of sorted) {
    let placed = false
    for (const col of cols) {
      if ((ev.occ.metadata.jsTime?.getTime() ?? 0) >= col[col.length - 1].endMs) {
        col.push(ev); placed = true; break
      }
    }
    if (!placed) cols.push([ev])
  }
  return cols
}
