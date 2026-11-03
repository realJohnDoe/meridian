import { fmtISO } from '@/model'
import { occKind, HUE_ORDER, type OccHue } from '@/occView'
import type { Occurrence } from '@/types'

const MAX_DOTS_PER_DAY = 4

/**
 * Buckets `occs` by the local calendar day of `metadata.jsTime`, one dot list
 * per day, ordered by `HUE_ORDER`, deduped, capped at `MAX_DOTS_PER_DAY`.
 *
 * `hueOf` is `OccPainter.hue` — the color source the user picked, which is why
 * the dots follow the same preference as every other occurrence surface. It is
 * deliberately the painter's *hue*, not its tone: `occState()` collapses every
 * completed task to `'done'`, and a day whose only task got done still had
 * something on it, so a dot keeps the color it had.
 *
 * Notes carry no date (`date === ''`), so calendar expansion never produces one
 * for them (see `undatedOccs.ts`) — the guard below is belt-and-braces for a
 * caller that hands over an unfiltered list.
 *
 * Deliberately does not dedupe by `o.id` the way `MonthGrid` does for its
 * multiday lanes: `expandWithMultiday` emits one virtual occurrence per day a
 * multiday event covers, and every one of those must dot its own day.
 */
export function dayDotsFor(
  occs: Occurrence[],
  hueOf: (o: Occurrence) => OccHue,
): Map<string, OccHue[]> {
  const byDay = new Map<string, Set<OccHue>>()
  for (const occ of occs) {
    if (!occ.metadata.jsTime) continue
    if (occKind(occ) === 'note') continue
    const hue = hueOf(occ)
    const iso = fmtISO(occ.metadata.jsTime)
    const existing = byDay.get(iso)
    if (existing) existing.add(hue)
    else byDay.set(iso, new Set([hue]))
  }

  const result = new Map<string, OccHue[]>()
  for (const [iso, hues] of byDay) {
    result.set(iso, HUE_ORDER.filter(h => hues.has(h)).slice(0, MAX_DOTS_PER_DAY))
  }
  return result
}
