/**
 * Returns the whole-day count if `dur` is in day format ("3d", "2 days", etc.),
 * null otherwise. Used to determine whether an event spans multiple calendar days.
 */
export function parseDurationDays(dur: unknown): number | null {
  if (!dur) return null
  const s = String(dur).toLowerCase().trim()
  const units: [RegExp, number][] = [
    [/^(\d+)\s*d(?:ay)?s?$/,      1],
    [/^(\d+)\s*w(?:eek)?s?$/,     7],
    [/^(\d+)\s*mo(?:nth)?s?$/,   30],
  ]
  for (const [re, factor] of units) {
    const m = s.match(re)
    if (m) return parseInt(m[1], 10) * factor
  }
  return null
}

export function parseDurationHours(dur: unknown): number {
  if (!dur) return 0.75
  const s = String(dur).toLowerCase().trim()
  let h = 0, m = 0
  const dm = s.match(/^(\d+(?:\.\d+)?)\s*d(?:ay)?s?$/)
  if (dm) return parseFloat(dm[1]) * 24
  const hm = s.match(/(\d+(?:\.\d+)?)\s*h/)
  const mm = s.match(/(\d+)\s*m/)
  if (hm) h = parseFloat(hm[1])
  if (mm) m = parseInt(mm[1], 10)
  if (!hm && !mm) { const n = parseFloat(s); if (!isNaN(n)) h = n }
  const total = h + m / 60
  return total > 0 ? total : 0.75
}
