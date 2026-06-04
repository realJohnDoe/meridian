/**
 * Meridian expansion pipeline — single module.
 *
 * Consolidates:
 *   src/recurrence.ts          — date helpers + low-level expansion engine
 *   src/model/expand.ts        — inheritance-aware expandRange
 *   src/model/repeatExpander.ts — OccurrenceEntry / collectors
 *
 * Public surface:
 *   - Date helpers: fmtISO, fmtT, parseDateString, toDate, nodeDateTime,
 *                   jsDateToSpec, addInterval, parseDurationHours, mergeNode
 *   - Engine:       expandNode
 *   - Model types:  OccurrenceEntry<T>, RepeatPattern<T>
 *   - Predicates:   hasRepeat, treeHasRepeat, treeHasOccurrences
 *   - Collectors:   expandRepeat, collectAllOccurrences, collectRepeatPatterns
 *   - Main-app API: expandRange
 */

import {
  format, isValid, parseISO,
  addDays, addWeeks, addMonths, addYears, addHours, addMinutes,
} from 'date-fns'
import type { Repeat, StoreItem, AppMetadata } from '../types'
import { isSeries } from '../types'
import type { EffectiveNode } from './inheritance'

// ─────────────────────────────────────────────────────────────────────────────
// DATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function fmtISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

export function fmtT(v: unknown): string | null {
  if (!v) return null
  if (typeof v === 'string' && /^\d{1,2}:\d{2}/.test(v)) return v.slice(0, 5)
  if (v instanceof Date) {
    const h = v.getHours(), m = v.getMinutes()
    return (h || m) ? format(v, 'HH:mm') : null
  }
  return null
}

export function parseDateString(s: unknown): Date | null {
  if (!s) return null
  if (s instanceof Date) return isValid(s) ? s : null
  const dm = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (dm) return new Date(+dm[1], +dm[2] - 1, +dm[3])
  const d = parseISO(String(s))
  return isValid(d) ? d : null
}

export function toDate(v: unknown): Date | null {
  if (!v) return null
  if (v instanceof Date) return isValid(v) ? v : null
  return parseDateString(String(v))
}

export function addInterval(date: Date, intervalStr: string): Date {
  const m = String(intervalStr).match(/(\d+)\s*(day|week|hour|minute|month|year)s?/i)
  if (!m) return date
  const n = parseInt(m[1], 10)
  const unit = m[2].toLowerCase()
  if (unit === 'day')    return addDays(date, n)
  if (unit === 'week')   return addWeeks(date, n)
  if (unit === 'month')  return addMonths(date, n)
  if (unit === 'year')   return addYears(date, n)
  if (unit === 'hour')   return addHours(date, n)
  if (unit === 'minute') return addMinutes(date, n)
  return date
}

export function nodeDateTime(node: Record<string, unknown>): Date | null {
  const dateStr = node.date
  const timeStr = node.time
  if (!dateStr) return null
  const dm = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dm) return null
  const [, y, mo, d] = dm.map(Number)
  if (timeStr) {
    const tm = String(timeStr).match(/^(\d{1,2}):(\d{2})/)
    if (tm) return new Date(y, mo - 1, d, +tm[1], +tm[2], 0, 0)
  }
  return new Date(y, mo - 1, d, 0, 0, 0, 0)
}

export function jsDateToSpec(jsDate: Date): { date: string | null; time: string | null } {
  if (!jsDate || !isValid(jsDate)) return { date: null, time: null }
  return { date: fmtISO(jsDate), time: fmtT(jsDate) }
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

/**
 * Returns the whole-day count if `dur` is in day format ("3d", "2 days", etc.),
 * null otherwise. Used to determine whether an event spans multiple calendar days.
 */
export function parseDurationDays(dur: unknown): number | null {
  if (!dur) return null
  const m = String(dur).toLowerCase().trim().match(/^(\d+)\s*d(?:ay)?s?$/)
  return m ? parseInt(m[1], 10) : null
}

/**
 * Returns true when `occ` is a multi-day event (duration ≥ 2d) whose span
 * includes `date`. Used by calendar views to show the event on every covered
 * day without expanding it into multiple occurrences.
 */
export function multidayCoversDate(occ: OccurrenceEntry<AppMetadata>, date: Date): boolean {
  const days = parseDurationDays(occ.metadata.duration)
  if (!days || days < 2) return false
  const start = parseDateString(occ.date)
  if (!start) return false
  const s = new Date(start); s.setHours(0, 0, 0, 0)
  const e = new Date(s.getTime() + (days - 1) * 86_400_000); e.setHours(23, 59, 59)
  const d = new Date(date); d.setHours(0, 0, 0, 0)
  return d >= s && d <= e
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPANSION ENGINE  (logic preserved from recurrence.ts)
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

const WDAYS_MAP: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 }

export function mergeNode(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...parent }
  for (const [k, v] of Object.entries(child)) {
    if (k === 'instances') continue
    if (v && typeof v === 'object' && !Array.isArray(v) && (v as any).type !== undefined) {
      merged[k] = v
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      merged[k] = mergeNode((merged[k] || {}) as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      merged[k] = v
    }
  }
  return merged
}

function generateScheduledDates(
  anchor: Date,
  anchorTimeStr: unknown,
  sched: Record<string, any>,
  from: Date,
  to: Date,
): Date[] {
  const { freq, byweekday, bymonthday, bysetpos, interval = 1, end } = sched
  const results: Date[] = []
  const maxDate = end?.type === 'until' ? (toDate(end.date || end.time) ?? to) : to
  let maxCount = end?.type === 'count' ? end.occurrences : Infinity
  let count = 0

  function withTime(d: Date): Date {
    const r = new Date(d)
    if (anchorTimeStr) {
      const tm = String(anchorTimeStr).match(/^(\d{1,2}):(\d{2})/)
      if (tm) r.setHours(+tm[1], +tm[2], 0, 0)
    } else {
      r.setHours(0, 0, 0, 0)
    }
    return r
  }

  function nextBase(d: Date): Date {
    const n = new Date(d)
    if (freq === 'daily')        n.setDate(n.getDate() + interval)
    else if (freq === 'weekly')  n.setDate(n.getDate() + 7 * interval)
    else if (freq === 'monthly') n.setMonth(n.getMonth() + interval)
    else if (freq === 'yearly')  n.setFullYear(n.getFullYear() + interval)
    return n
  }

  function matchesInPeriod(periodStart: Date): Date[] {
    const dates: Date[] = []
    if (freq === 'daily') {
      dates.push(withTime(periodStart))
    } else if (freq === 'weekly') {
      if (!byweekday || !byweekday.length) {
        dates.push(withTime(periodStart))
      } else {
        const wd = periodStart.getDay()
        const mondayOff = wd === 0 ? -6 : 1 - wd
        const weekStart = new Date(periodStart)
        weekStart.setDate(periodStart.getDate() + mondayOff)
        for (const dStr of byweekday) {
          const target = WDAYS_MAP[dStr.toLowerCase()] ?? 0
          const dayCandidate = new Date(weekStart)
          dayCandidate.setDate(weekStart.getDate() + (target === 0 ? 6 : target - 1))
          dates.push(withTime(dayCandidate))
        }
      }
    } else if (freq === 'monthly') {
      if (bymonthday && bymonthday.length) {
        for (const mday of bymonthday) {
          dates.push(withTime(new Date(periodStart.getFullYear(), periodStart.getMonth(), mday)))
        }
      } else if (byweekday && byweekday.length && bysetpos !== undefined) {
        const month = periodStart.getMonth(), year = periodStart.getFullYear()
        const candidates: Date[] = []
        const daysInMonth = new Date(year, month + 1, 0).getDate()
        const targetDays = byweekday.map((d: string) => WDAYS_MAP[d.toLowerCase()] ?? 0)
        for (let day = 1; day <= daysInMonth; day++) {
          const d2 = new Date(year, month, day)
          if (targetDays.includes(d2.getDay())) candidates.push(d2)
        }
        const pos = bysetpos < 0 ? candidates.length + bysetpos : bysetpos - 1
        if (candidates[pos]) dates.push(withTime(candidates[pos]))
      } else {
        dates.push(withTime(new Date(periodStart.getFullYear(), periodStart.getMonth(), anchor.getDate())))
      }
    } else if (freq === 'yearly') {
      dates.push(withTime(new Date(periodStart.getFullYear(), anchor.getMonth(), anchor.getDate())))
    }
    return dates
  }

  let cursor = new Date(anchor)
  const LIMIT = 500; let iter = 0
  while (cursor <= maxDate && count < maxCount && iter++ < LIMIT) {
    const dates = matchesInPeriod(cursor).filter(d => d > anchor && d >= from && d <= maxDate && d <= to)
    for (const d of dates.sort((a, b) => a.getTime() - b.getTime())) {
      if (d > anchor && count < maxCount) { results.push(d); count++ }
    }
    cursor = nextBase(cursor)
    if (cursor > maxDate || cursor > to) break
  }
  return results
}

export function expandNode(
  node: Record<string, any>,
  from: Date,
  to: Date,
): Record<string, unknown>[] {
  const occurrences: Record<string, unknown>[] = []
  const anchor = nodeDateTime(node)
  if (!anchor) return occurrences

  const instanceOverrides = ((node.instances || []) as Record<string, any>[]).map(child => {
    const t = nodeDateTime(child)
    if (!t && !child.date) return null
    const hasTime = !!child.time
    const matchDate = child.date ? parseDateString(child.date) : t
    return {
      ms: t ? t.getTime() : matchDate ? matchDate.getTime() : 0,
      hasTime,
      matchDate,
      child,
      eff: mergeNode(node, child),
    }
  }).filter(Boolean) as Array<{ ms: number; hasTime: boolean; matchDate: Date | null; child: any; eff: Record<string, unknown> }>

  function findOverride(jsDate: Date) {
    for (const o of instanceOverrides) {
      if (!o.hasTime) {
        const od = o.matchDate
        if (od && od.getFullYear() === jsDate.getFullYear() && od.getMonth() === jsDate.getMonth() && od.getDate() === jsDate.getDate()) return o
      } else {
        if (Math.abs(o.ms - jsDate.getTime()) < 60000) return o
      }
    }
    return null
  }

  function makeOcc(eff: Record<string, unknown>, jsDate: Date, baseNode: Record<string, any>, instOverride: any) {
    if (eff.excluded) return null
    const occTimeStr = (eff.time || baseNode.time || node.time) as string | null ?? null
    const occDate = (instOverride && instOverride.child.date && instOverride.child.date !== node.date)
      ? instOverride.child.date
      : jsDateToSpec(jsDate).date
    return { ...eff, date: occDate, time: occTimeStr, jsTime: jsDate, recur: true, _nodeId: node.id, _node: node }
  }

  if (node.repeat?.type !== 'after_completion') {
    if (anchor >= from && anchor <= to) {
      const ov = findOverride(anchor)
      const occ = makeOcc(ov ? ov.eff : node, anchor, node, ov)
      if (occ) occurrences.push(occ)
    }
  }

  if (!node.repeat) return occurrences

  if (node.repeat.type === 'schedule') {
    const sched = node.repeat
    const generated = generateScheduledDates(anchor, node.time, sched, from, to)
    const generatedMs = new Set(generated.map(d => d.getTime()))
    generatedMs.add(anchor.getTime())

    for (const genDate of generated) {
      const ov = findOverride(genDate)
      const occ = makeOcc(ov ? ov.eff : node, genDate, node, ov)
      if (occ) occurrences.push(occ)
    }

    for (const inst of (node.instances || []) as Record<string, any>[]) {
      if (inst.excluded) continue
      const t = nodeDateTime(inst)
      if (!t) continue
      let isGenerated = false
      if (!inst.time) {
        isGenerated = [...generatedMs].some(ms => {
          const gd = new Date(ms)
          return gd.getFullYear() === t.getFullYear() && gd.getMonth() === t.getMonth() && gd.getDate() === t.getDate()
        })
      } else {
        isGenerated = [...generatedMs].some(ms => Math.abs(ms - t.getTime()) < 60000)
      }
      if (!isGenerated && t >= from && t <= to) {
        const eff = mergeNode(node, inst)
        if (!eff.excluded) {
          occurrences.push({ ...eff, date: inst.date || jsDateToSpec(t).date, jsTime: t, recur: true, _nodeId: node.id, _node: node })
        }
      }
    }
  } else if (node.repeat.type === 'after_completion') {
    const allTimes: Array<{ jsTime: Date; done: unknown; priority: unknown }> = []
    const anchorInst = ((node.instances || []) as Record<string, any>[]).find(i => {
      const t = nodeDateTime(i) || parseDateString(i.date)
      return t && Math.abs(t.getTime() - anchor.getTime()) < 60000
    })
    if (!anchorInst?.excluded) {
      allTimes.push({ jsTime: anchor, done: anchorInst !== undefined ? anchorInst.done : node.done, priority: anchorInst?.priority || node.priority })
    }
    for (const inst of (node.instances || []) as Record<string, any>[]) {
      const t = nodeDateTime(inst) || parseDateString(inst.date)
      if (!t || inst.excluded) continue
      if (Math.abs(t.getTime() - anchor.getTime()) < 60000) continue
      allTimes.push({ jsTime: t, done: inst.done, priority: inst.priority || node.priority })
    }
    allTimes.sort((a, b) => a.jsTime.getTime() - b.jsTime.getTime())

    for (const entry of allTimes) {
      if (entry.jsTime >= from && entry.jsTime <= to) {
        const spec = jsDateToSpec(entry.jsTime)
        occurrences.push({ ...node, date: spec.date, time: spec.time || node.time || null, jsTime: entry.jsTime, done: entry.done, priority: entry.priority, recur: true, _nodeId: node.id, _node: node })
      }
    }
    const lastDone = [...allTimes].reverse().find(e => e.done === true)
    if (lastDone) {
      const nextJsTime = addInterval(lastDone.jsTime, String(node.repeat.interval || '1 day'))
      const alreadyExists = allTimes.some(e => Math.abs(e.jsTime.getTime() - nextJsTime.getTime()) < 60000)
      const isExcluded = ((node.instances || []) as Record<string, any>[]).some(inst => {
        if (!inst.excluded) return false
        const t = parseDateString(inst.date)
        return t !== null && Math.abs(t.getTime() - nextJsTime.getTime()) < 60000
      })
      if (!alreadyExists && !isExcluded && nextJsTime >= from && nextJsTime <= to) {
        const spec = jsDateToSpec(nextJsTime)
        occurrences.push({ ...node, date: spec.date, time: spec.time || node.time || null, jsTime: nextJsTime, done: false, recur: true, _nodeId: node.id, _node: node })
      }
    }
  }

  for (const child of (node.instances || []) as Record<string, any>[]) {
    if (child.repeat) {
      const effChild = mergeNode(node, child)
      occurrences.push(...expandNode({ ...effChild, instances: [] }, from, to))
    }
  }

  return occurrences
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ─────────────────────────────────────────────────────────────────────────────
// MODEL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fields excluded from the `metadata` blob because they are either already
 * present as top-level fields on OccurrenceEntry, or are structural/internal.
 * The extractor function still receives the FULL raw fields object and may
 * include any of these explicitly if needed (e.g. _nodeId, _node for AppMetadata).
 */
export const METADATA_EXCLUDE = new Set([
  'date', 'time',                           // top-level on OccurrenceEntry
  'instances', 'defaults',                  // structural tree fields
  'excluded',                               // exclusion sentinel
  '_isGenerated',                           // internal source-tagging field
])

/**
 * A concrete resolved occurrence (single point in time).
 * `T` is the metadata type defined by the caller.
 */
export interface OccurrenceEntry<T = Record<string, unknown>> {
  date:      string                    // YYYY-MM-DD
  time:      string | null             // HH:mm or null
  source:    'generated' | 'explicit'
  fileSlug:  string                    // identifies source file (= node.id)
  id:        string                    // own UUID; stable across promotion to RepeatPattern
  ownerId?:  string                    // UUID of parent RepeatPattern (undefined for standalone)
  excluded?: boolean                   // exclusion override: suppresses a generated occurrence
  metadata:  T
}

/**
 * A recurring series node — produces OccurrenceEntry values via expansion.
 * `T` is the metadata type defined by the caller.
 */
export interface RepeatPattern<T = Record<string, unknown>> {
  date:      string
  time:      string | null
  repeat:    Repeat
  fileSlug:  string
  id:        string                    // own UUID
  // No ownerId — RepeatPatterns are flat siblings, never nested in the store
  metadata:  T
}

// ─────────────────────────────────────────────────────────────────────────────
// EFFECTIVENODE PREDICATES
// ─────────────────────────────────────────────────────────────────────────────

export function hasRepeat(node: EffectiveNode): boolean {
  return node.fields.repeat !== undefined && node.fields.repeat !== null
}

export function treeHasRepeat(node: EffectiveNode): boolean {
  if (hasRepeat(node)) return true
  return node.instances.some(treeHasRepeat)
}

export function treeHasOccurrences(node: EffectiveNode): boolean {
  if (hasRepeat(node) || node.fields.date !== undefined) return true
  return node.instances.some(treeHasOccurrences)
}

// ─────────────────────────────────────────────────────────────────────────────
// TOEXPANDABLE  (internal)
// ─────────────────────────────────────────────────────────────────────────────

const SCHEDULING_FIELDS = new Set(['date', 'time', 'repeat', 'instances', 'excluded', 'defaults'])

/**
 * Build a duck-typed node suitable for expandNode() from an EffectiveNode.
 *
 * Generated occurrences are semantically virtual children with only a date
 * override, so they should inherit from the node's accumulated childDefaults —
 * the same defaults its explicit child instances inherit.  This correctly
 * handles series that store task defaults (done, priority, …) inside a
 * `defaults:` block rather than as direct fields.
 */
function toExpandable(node: EffectiveNode): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...node.fields }

  // Seed base values for generated occurrences from accumulated child defaults.
  // Fields already on the node and scheduling-structural keys are skipped.
  for (const [key, value] of Object.entries(node.childDefaults)) {
    if (!SCHEDULING_FIELDS.has(key) && !(key in fields)) {
      fields[key] = value
    }
  }

  fields.instances = node.instances.map(child => ({ ...child.fields }))
  return fields
}

function generatedDateSet(expandable: Record<string, unknown>, from: Date, to: Date): Set<string> {
  const noInsts = { ...expandable, instances: [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = expandNode(noInsts as any, from, to) as Record<string, unknown>[]
  return new Set(raw.map(o => String(o.date ?? '')))
}

// ─────────────────────────────────────────────────────────────────────────────
// COLLECTORS (generic)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expand the repeat schedule of an EffectiveNode up to `endDateStr`.
 * `extractMetadata` converts the raw merged occurrence fields to the caller's type.
 */
export function expandRepeat<T>(
  node: EffectiveNode,
  endDateStr: string,
  extractMetadata: (fields: Record<string, unknown>) => T,
  fileSlug: string = '',
  ownerId: string = '',
): OccurrenceEntry<T>[] {
  const expandable = toExpandable(node)
  const from = new Date(0)
  const to   = new Date(`${endDateStr}T23:59:59`)
  if (isNaN(to.getTime())) return []

  const genDates = generatedDateSet(expandable, from, to)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = expandNode(expandable as any, from, to) as Record<string, unknown>[]

  return raw.map(occ => {
    const src: 'generated' | 'explicit' =
      genDates.has(String(occ.date ?? '')) ? 'generated' : 'explicit'
    const metaFields = Object.fromEntries(
      Object.entries(occ).filter(([k]) => !METADATA_EXCLUDE.has(k)),
    )
    const entry: OccurrenceEntry<T> = {
      date:     String(occ.date ?? ''),
      time:     occ.time ? String(occ.time) : null,
      source:   src,
      fileSlug,
      id:       crypto.randomUUID(),
      metadata: extractMetadata(metaFields),
    }
    if (ownerId) entry.ownerId = ownerId
    return entry
  })
}

/**
 * Walk the entire EffectiveNode tree and collect all concrete occurrences.
 * Handles container roots (split-series pattern) where `repeat` lives on children.
 */
export function collectAllOccurrences<T>(
  node: EffectiveNode,
  endDateStr: string,
  extractMetadata: (fields: Record<string, unknown>) => T,
  fileSlug: string = '',
): OccurrenceEntry<T>[] {
  const results: OccurrenceEntry<T>[] = []
  const to = new Date(`${endDateStr}T23:59:59`)

  function walk(n: EffectiveNode, ownerId: string) {
    if (hasRepeat(n)) {
      results.push(...expandRepeat(n, endDateStr, extractMetadata, fileSlug, ownerId))
    } else if (n.fields.date !== undefined) {
      const dateStr = String(n.fields.date)
      const d = new Date(`${dateStr}T00:00:00`)
      if (!isNaN(d.getTime()) && d <= to) {
        const metaFields = Object.fromEntries(
          Object.entries(n.fields).filter(([k]) => !METADATA_EXCLUDE.has(k)),
        )
        const entry: OccurrenceEntry<T> = {
          date:     dateStr,
          time:     n.fields.time ? String(n.fields.time) : null,
          source:   'explicit',
          fileSlug,
          id:       crypto.randomUUID(),
          metadata: extractMetadata(metaFields),
        }
        if (ownerId) entry.ownerId = ownerId
        results.push(entry)
      }
    } else {
      n.instances.forEach(child => walk(child, ownerId))
    }
  }

  walk(node, '')

  return results.sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    if (d !== 0) return d
    return (a.time ?? '').localeCompare(b.time ?? '')
  })
}

/**
 * Walk the EffectiveNode tree and collect one RepeatPattern per series node.
 */
export function collectRepeatPatterns<T>(
  node: EffectiveNode,
  extractMetadata: (fields: Record<string, unknown>) => T,
  fileSlug: string = '',
): RepeatPattern<T>[] {
  const results: RepeatPattern<T>[] = []

  function walk(n: EffectiveNode) {
    if (hasRepeat(n)) {
      const metaFields = Object.fromEntries(
        Object.entries(n.fields).filter(([k]) => !METADATA_EXCLUDE.has(k)),
      )
      results.push({
        date:     String(n.fields.date ?? ''),
        time:     n.fields.time ? String(n.fields.time) : null,
        repeat:   n.fields.repeat as Repeat,
        fileSlug,
        id:       crypto.randomUUID(),
        metadata: extractMetadata(metaFields),
      })
    }
    n.instances.forEach(child => walk(child))
  }

  walk(node)
  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPANDRANGE  (main-app entry point — takes StoreItem[])
// ─────────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Expand StoreItem[] in the date range [from, to].
 * Series items are expanded via their repeat rule; standalone OccurrenceEntry
 * items are emitted directly if they fall in range.
 * Each output occurrence carries ownerId = series.id so the editor can detect
 * recurring items and look up the parent series.
 */
export function expandRange(
  items: StoreItem[],
  from: Date,
  to: Date,
): OccurrenceEntry<AppMetadata>[] {
  const result: OccurrenceEntry<AppMetadata>[] = []

  const seriesList = items.filter(isSeries)
  // Standalone = non-series items with no ownerId (direct root-level items)
  const standalones = items.filter(i => !isSeries(i) && !(i as OccurrenceEntry<AppMetadata>).ownerId) as OccurrenceEntry<AppMetadata>[]

  // ── Expand each series ────────────────────────────────────────────────────
  for (const series of seriesList) {
    const children = items.filter(
      i => !isSeries(i) && (i as OccurrenceEntry<AppMetadata>).ownerId === series.id,
    ) as OccurrenceEntry<AppMetadata>[]

    const expandable: Record<string, any> = {
      ...series.metadata,
      date:     series.date,
      time:     series.time,
      repeat:   series.repeat,
      instances: children.map(c => ({
        date:     c.date,
        time:     c.time ?? undefined,
        excluded: c.excluded,
        ...c.metadata,
      })),
    }

    const genDates = generatedDateSet(expandable, from, to)
    const raw = expandNode(expandable, from, to) as Record<string, any>[]

    for (const occ of raw) {
      const jsTime = occ.jsTime as Date | undefined
      if (!jsTime) continue
      const isGenerated = genDates.has(String(occ.date ?? ''))

      // Find an explicit override whose date matches this occurrence
      const override = children.find(c => {
        const ct = nodeDateTime(c as any) || parseDateString(c.date)
        return ct && Math.abs(ct.getTime() - jsTime.getTime()) < 60000
      })

      result.push({
        date:    String(occ.date ?? ''),
        time:    occ.time ? String(occ.time) : null,
        source:  isGenerated ? 'generated' : 'explicit',
        fileSlug: series.fileSlug,
        id:      crypto.randomUUID(),
        ownerId: series.id,
        metadata: {
          ...(override ? { ...series.metadata, ...override.metadata } : series.metadata),
          jsTime,
        },
      })
    }
  }

  // ── Emit standalone occurrences ───────────────────────────────────────────
  // Multi-day events emit a single occurrence on their start date, identical to
  // any other event. The span is inferred from `duration` by callers via
  // parseDurationDays / multidayCoversDate — nothing is stored in the model.
  for (const occ of standalones) {
    const jsTime = nodeDateTime({ date: occ.date, time: occ.time } as any)
      ?? parseDateString(occ.date)
    if (!jsTime || jsTime < from || jsTime > to) continue
    result.push({
      ...occ,
      id:       crypto.randomUUID(),
      metadata: { ...occ.metadata, jsTime },
    })
  }

  // ── Deduplicate by (fileSlug, jsTime) and sort ────────────────────────────
  const seen = new Set<string>()
  return result
    .filter(o => {
      if (!o.metadata.jsTime) return false
      const k = `${o.fileSlug}|${o.metadata.jsTime.getTime()}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => (a.metadata.jsTime?.getTime() ?? 0) - (b.metadata.jsTime?.getTime() ?? 0))
}

/* eslint-enable @typescript-eslint/no-explicit-any */
