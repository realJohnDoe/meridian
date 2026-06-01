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
import type { Repeat } from '../types'
import { buildEffectiveTree } from './inheritance'
import type { EffectiveNode } from './inheritance'
import type { RawNode } from './nodeSchema'

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
  const hm = s.match(/(\d+(?:\.\d+)?)\s*h/)
  const mm = s.match(/(\d+)\s*m/)
  if (hm) h = parseFloat(hm[1])
  if (mm) m = parseInt(mm[1], 10)
  if (!hm && !mm) { const n = parseFloat(s); if (!isNaN(n)) h = n }
  const total = h + m / 60
  return total > 0 ? total : 0.75
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
      if (!alreadyExists && nextJsTime >= from && nextJsTime <= to) {
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
  'date', 'time', 'jsTime', 'ownerPath',   // top-level on OccurrenceEntry
  'instances', 'defaults',                  // structural tree fields
  'excluded',                               // exclusion sentinel
])

/**
 * A concrete resolved occurrence (single point in time).
 * `T` is the metadata type defined by the caller.
 */
export interface OccurrenceEntry<T = Record<string, unknown>> {
  date:      string                    // YYYY-MM-DD
  time:      string | null             // HH:mm or null
  jsTime:    Date                      // kept top-level for sort / layout
  source:    'generated' | 'explicit'
  ownerPath: number[]
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
  ownerPath: number[]
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
  ownerPath: number[] = [],
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
    return {
      date:      String(occ.date ?? ''),
      time:      occ.time ? String(occ.time) : null,
      jsTime:    occ.jsTime as Date,
      source:    src,
      ownerPath,
      metadata:  extractMetadata(metaFields),
    }
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
): OccurrenceEntry<T>[] {
  const results: OccurrenceEntry<T>[] = []
  const to = new Date(`${endDateStr}T23:59:59`)

  function walk(n: EffectiveNode, path: number[]) {
    if (hasRepeat(n)) {
      results.push(...expandRepeat(n, endDateStr, extractMetadata, path))
    } else if (n.fields.date !== undefined) {
      const dateStr = String(n.fields.date)
      const d = new Date(`${dateStr}T00:00:00`)
      if (!isNaN(d.getTime()) && d <= to) {
        const metaFields = Object.fromEntries(
          Object.entries(n.fields).filter(([k]) => !METADATA_EXCLUDE.has(k)),
        )
        results.push({
          date:      dateStr,
          time:      n.fields.time ? String(n.fields.time) : null,
          jsTime:    n.fields.time
            ? new Date(`${dateStr}T${String(n.fields.time)}`)
            : new Date(`${dateStr}T00:00:00`),
          source:    'explicit',
          ownerPath: path,
          metadata:  extractMetadata(metaFields),
        })
      }
    } else {
      n.instances.forEach((child, i) => walk(child, [...path, i]))
    }
  }

  walk(node, [])

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
): RepeatPattern<T>[] {
  const results: RepeatPattern<T>[] = []

  function walk(n: EffectiveNode, path: number[]) {
    if (hasRepeat(n)) {
      const metaFields = Object.fromEntries(
        Object.entries(n.fields).filter(([k]) => !METADATA_EXCLUDE.has(k)),
      )
      results.push({
        date:      String(n.fields.date ?? ''),
        time:      n.fields.time ? String(n.fields.time) : null,
        repeat:    n.fields.repeat as Repeat,
        ownerPath: path,
        metadata:  extractMetadata(metaFields),
      })
    }
    n.instances.forEach((child, i) => walk(child, [...path, i]))
  }

  walk(node, [])
  return results
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPANDRANGE  (inheritance-aware, main-app entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Expand `nodes` in the date range [from, to], applying `defaults:`-driven
 * inheritance before generating occurrences.
 *
 * Generic over `T`: supply an `extractMetadata` function to get a fully typed
 * result.  Omit it (or pass `f => f`) to get `OccurrenceEntry<Record<string, unknown>>`.
 */
export function expandRange<T = Record<string, unknown>>(
  nodes: unknown[],
  from: Date,
  to: Date,
  extractMetadata: (fields: Record<string, unknown>) => T = (f => f as unknown as T),
): OccurrenceEntry<T>[] {
  function addDaysLocal(d: Date, n: number): Date {
    const r = new Date(d); r.setDate(r.getDate() + n); return r
  }

  const all: Record<string, unknown>[] = []

  for (const rawNode of nodes) {
    const effective = buildEffectiveTree(rawNode as RawNode)

    const node = {
      ...effective.fields,
      instances: effective.instances.map(child => ({ ...child.fields })),
    } as Record<string, unknown>

    if (node.multiday) {
      const md = node.multiday as { start?: string; end?: string }
      let d = parseDateString((md.start || node.date) as string)
      if (!d) continue
      d = new Date(d); d.setHours(0, 0, 0, 0)
      const endD = parseDateString(md.end as string)
      if (!endD) continue
      const endDt = new Date(endD); endDt.setHours(23, 59, 59)
      while (d <= endDt) {
        if (d >= from && d <= to) {
          const spec = jsDateToSpec(d)
          all.push({ ...node, date: spec.date, time: null, jsTime: new Date(d), _nodeId: (rawNode as Record<string, unknown>).id, _node: rawNode, recur: false, ownerPath: [] })
        }
        d = addDaysLocal(d, 1)
      }
    } else if (node.repeat) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const occs = expandNode(node as any, from, to) as Record<string, unknown>[]
      all.push(...occs.map(o => ({ ...o, ownerPath: [] })))
    } else {
      const nodeInstances = (node.instances as unknown[]) || []
      const hasRepeatInstances = nodeInstances.some(
        (i: unknown) => !!(i as Record<string, unknown>).repeat && !(i as Record<string, unknown>).excluded,
      )
      for (let instIdx = 0; instIdx < nodeInstances.length; instIdx++) {
        const inst = nodeInstances[instIdx] as Record<string, unknown>
        if (!inst.repeat || inst.excluded) continue
        const effChild = mergeNode(node, inst) as Record<string, unknown>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const occs = expandNode({ ...effChild, instances: [] } as any, from, to) as Record<string, unknown>[]
        all.push(...occs.map(o => ({ ...o, ownerPath: [instIdx] })))
      }

      const liveInstances = nodeInstances.filter(
        (i: unknown) => !(i as Record<string, unknown>).excluded && !(i as Record<string, unknown>).repeat,
      )
      if (liveInstances.length > 0) {
        for (const inst of liveInstances) {
          const it = nodeDateTime(inst as Record<string, unknown>) || parseDateString((inst as Record<string, unknown>).date as string)
          if (!it || it < from || it > to) continue
          const eff = mergeNode(node, inst as Record<string, unknown>)
          if (!eff.excluded) {
            all.push({
              ...eff,
              date: (inst as Record<string, unknown>).date || jsDateToSpec(it).date,
              jsTime: it,
              _nodeId: (rawNode as Record<string, unknown>).id,
              _node: rawNode,
              recur: true,
              ownerPath: [],
            })
          }
        }
      } else if (!hasRepeatInstances) {
        const t = nodeDateTime(node)
        if (t && t >= from && t <= to) {
          all.push({ ...node, jsTime: t, _nodeId: (rawNode as Record<string, unknown>).id, _node: rawNode, recur: false, ownerPath: [] })
        }
      }
    }
  }

  // Deduplicate by (nodeId, jsTime)
  const seen = new Set<string>()
  const deduped = all.filter(o => {
    if (!o.jsTime) return false
    const k = `${o._nodeId || o.title}|${(o.jsTime as Date).getTime()}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).sort((a, b) => (a.jsTime as Date).getTime() - (b.jsTime as Date).getTime())

  // Map to OccurrenceEntry<T>
  return deduped.map(occ => {
    const metaFields = Object.fromEntries(
      Object.entries(occ).filter(([k]) => !METADATA_EXCLUDE.has(k)),
    )
    return {
      date:      String(occ.date ?? ''),
      time:      occ.time ? String(occ.time) : null,
      jsTime:    occ.jsTime as Date,
      source:    occ.recur === false ? 'explicit' : 'generated',
      ownerPath: (occ.ownerPath as number[]) ?? [],
      metadata:  extractMetadata(metaFields),
    }
  })
}
