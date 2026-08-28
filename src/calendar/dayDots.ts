import { fmtISO } from '@/model'
import { occKind } from '@/occView'
import type { Occurrence } from '@/types'

/**
 * The mini-calendar's per-day dot vocabulary — event / P1 / P2 / P3 / no-priority
 * task. Deliberately has no `'note'` member: notes carry no date (`date === ''`),
 * so the calendar expansion this module consumes never produces one for them
 * (see `undatedOccs.ts`).
 */
export type DotCategory = 'event' | 'p1' | 'p2' | 'p3' | 'task'

const CATEGORY_ORDER: DotCategory[] = ['event', 'p1', 'p2', 'p3', 'task']
const MAX_DOTS_PER_DAY = 4

/**
 * Dot fill color per category — the same solid tokens `occurrence-variants.ts`
 * uses for the full-size event/task colouring (`bg-event`, `bg-priority-1/2/3`,
 * `bg-task`), so a mini-calendar dot always agrees with what its day's own
 * occurrence chip looks like everywhere else.
 */
export const DOT_COLOR: Record<DotCategory, string> = {
  event: 'bg-event',
  p1:    'bg-priority-1',
  p2:    'bg-priority-2',
  p3:    'bg-priority-3',
  task:  'bg-task',
}

/**
 * Derives the dot category straight from `occKind` + priority, not from
 * `occState()` — `occState` collapses every completed task to `'done'`, which
 * would lose the priority color a completed task's dot still needs (a day
 * whose only task got done still had something on it).
 */
export function dotCategory(occ: Occurrence): DotCategory | undefined {
  const kind = occKind(occ)
  if (kind === 'note') return undefined
  if (kind === 'event') return 'event'
  const p = occ.metadata.priority
  if (p === 'high') return 'p1'
  if (p === 'medium') return 'p2'
  if (p === 'low') return 'p3'
  return 'task'
}

/**
 * Buckets `occs` by the local calendar day of `metadata.jsTime`, one dot list
 * per day, ordered event → p1 → p2 → p3 → task, deduped, capped at
 * `MAX_DOTS_PER_DAY`.
 *
 * Deliberately does not dedupe by `o.id` the way `MonthGrid` does for its
 * multiday lanes: `expandWithMultiday` emits one virtual occurrence per day a
 * multiday event covers, and every one of those must dot its own day.
 */
export function dayDotsFor(occs: Occurrence[]): Map<string, DotCategory[]> {
  const byDay = new Map<string, Set<DotCategory>>()
  for (const occ of occs) {
    if (!occ.metadata.jsTime) continue
    const category = dotCategory(occ)
    if (!category) continue
    const iso = fmtISO(occ.metadata.jsTime)
    const existing = byDay.get(iso)
    if (existing) existing.add(category)
    else byDay.set(iso, new Set([category]))
  }

  const result = new Map<string, DotCategory[]>()
  for (const [iso, categories] of byDay) {
    result.set(iso, CATEGORY_ORDER.filter(c => categories.has(c)).slice(0, MAX_DOTS_PER_DAY))
  }
  return result
}
