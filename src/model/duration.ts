/**
 * Duration string parsing.
 *
 * Accepted single-unit formats (case-insensitive):
 *   Full words  — "30 minutes", "2 hours", "3 days", "1 week", "2 months", "1 year"
 *                 Singular forms also accepted: "1 minute", "1 hour", etc.
 *   Abbreviated — "30m", "2h", "3d", "1w", "2mo", "1y"
 *
 * parseDurationHours additionally accepts compound hand-written forms: "1h 30m",
 * "1 hour 30 minutes". These cannot be represented as { n, unit } so they are
 * supported only as a numeric hour value (read-only hand-edit feature; the UI
 * always writes single-unit full-word strings via serialise()).
 */

export type DurationUnit = 'minutes' | 'hours' | 'days' | 'weeks' | 'months' | 'years'

/** Coerce a raw YAML scalar to a string, without pulling in fieldRegistry.ts (which
 * itself may need to canonicalise a duration string — see `serialiseDuration`). */
function toStr(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return undefined
}

/** Canonical single-unit parse. Returns null for unrecognised or compound strings. */
export function parseDuration(s: string): { n: number; unit: DurationUnit } | null {
  const m = s.trim().match(/^(\d+)\s*(.+)$/i)
  if (!m) return null
  const n   = parseInt(m[1]!, 10)  // both capture groups matched
  const raw = m[2]!.trim().toLowerCase()
  if (/^min(ute)?s?$/.test(raw) || raw === 'm')           return { n, unit: 'minutes' }
  if (/^h(our)?s?$/.test(raw)   || /^hrs?$/.test(raw))   return { n, unit: 'hours'   }
  if (/^d(ay)?s?$/.test(raw))                             return { n, unit: 'days'    }
  if (/^w(eek)?s?$/.test(raw))                            return { n, unit: 'weeks'   }
  if (/^mo(nth)?s?$/.test(raw))                           return { n, unit: 'months'  }
  if (/^y(ear)?s?$/.test(raw))                            return { n, unit: 'years'   }
  return null
}

/** Canonical serialisation: { n: 2, unit: 'weeks' } -> "2 weeks" (singular when n === 1). */
export function serialiseDuration(n: number, unit: DurationUnit): string {
  const label = n === 1 ? unit.replace(/s$/, '') : unit
  return `${n} ${label}`
}

/** Whole-day count for multi-day display; null for sub-day durations. */
export function parseDurationDays(dur: unknown): number | null {
  if (!dur) return null
  const str = toStr(dur)
  if (str === undefined) return null
  const p = parseDuration(str)
  if (!p) return null
  if (p.unit === 'days')   return p.n
  if (p.unit === 'weeks')  return p.n * 7
  if (p.unit === 'months') return p.n * 30
  if (p.unit === 'years')  return p.n * 365
  return null
}

/** Fractional hours for timeline layout and sorting. Falls back to 0.75 for unparseable input. */
export function parseDurationHours(dur: unknown): number {
  if (!dur) return 0.75
  const str = toStr(dur)
  if (str === undefined) return 0.75
  const s = str.trim()
  const p = parseDuration(s)
  if (p) {
    if (p.unit === 'minutes') return p.n / 60
    if (p.unit === 'hours')   return p.n
    if (p.unit === 'days')    return p.n * 24
    if (p.unit === 'weeks')   return p.n * 7 * 24
    if (p.unit === 'months')  return p.n * 30 * 24
    return p.n * 365 * 24
  }
  // Compound forms: "1h 30m", "1 hour 30 minutes"
  const sl = s.toLowerCase()
  const hm = sl.match(/(\d+(?:\.\d+)?)\s*h(?:our)?r?s?/)
  const mm = sl.match(/(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?/)
  if (hm || mm) {
    const total = (hm ? parseFloat(hm[1]!) : 0) + (mm ? parseFloat(mm[1]!) / 60 : 0)
    return total > 0 ? total : 0.75
  }
  // Bare number → hours
  const n = parseFloat(sl)
  return !isNaN(n) && n > 0 ? n : 0.75
}
