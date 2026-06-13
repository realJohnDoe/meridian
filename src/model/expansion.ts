/**
 * Meridian expansion pipeline.
 *
 * Public surface:
 *   - Types:        OccurrenceEntry<T>, RepeatPattern<T>
 *   - Predicates:   hasRepeat, treeHasOccurrences
 *   - Multiday:     multidayDisplayTitle, multidayCoversDate
 *   - Main-app API: expandRange, expandWithMultiday, collectUndated,
 *                   joinFileMeta, stableOccId
 *
 * Date helpers live in ./dateUtils; duration helpers in ./duration.
 */

import {
  isValid,
  addDays, addWeeks, addMonths, addYears, addHours, addMinutes,
} from 'date-fns'
import type { Repeat, StoreItem, StoreOcc, StoreSeries, OccurrenceMetadata, AppMetadata, Roots, Priority } from '../types'
import { isSeries, isStandaloneOcc } from '../types'
import type { EffectiveNode } from './inheritance'
import { fmtISO, fmtT, parseDateString } from './dateUtils'
import { parseDurationDays } from './duration'

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL DATE HELPERS  (not exported — no consumers outside this file)
// ─────────────────────────────────────────────────────────────────────────────

function toDate(v: unknown): Date | null {
  if (!v) return null
  if (v instanceof Date) return isValid(v) ? v : null
  return parseDateString(String(v))
}

function addInterval(date: Date, intervalStr: string): Date {
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

function nodeDateTime(node: { date: string; time: string | null }): Date | null {
  const dateStr = node.date
  const timeStr = node.time
  if (!dateStr) return null
  const dm = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!dm) return null
  const [, y, mo, d] = dm.map(Number)
  if (timeStr) {
    const tm = timeStr.match(/^(\d{1,2}):(\d{2})/)
    if (tm) return new Date(y, mo - 1, d, +tm[1], +tm[2], 0, 0)
  }
  return new Date(y, mo - 1, d, 0, 0, 0, 0)
}

function jsDateToSpec(jsDate: Date): { date: string | null; time: string | null } {
  if (!jsDate || !isValid(jsDate)) return { date: null, time: null }
  return { date: fmtISO(jsDate), time: fmtT(jsDate) }
}

// ─────────────────────────────────────────────────────────────────────────────
// MULTIDAY HELPERS  (exported — consumed by calendar views)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the display title for a multiday occurrence on the given view date,
 * e.g. "Mama in Esslingen (Day 3/15)". Returns undefined for non-multiday
 * events so callers can fall back to the original title.
 */
export function multidayDisplayTitle(
  occ: OccurrenceEntry<AppMetadata>,
  viewDate: Date,
): string | undefined {
  const days = parseDurationDays(occ.metadata.duration) ?? 0
  if (days < 2) return undefined
  const startD = parseDateString(occ.date)
  if (!startD) return undefined
  const dayIdx = Math.round((viewDate.getTime() - startD.getTime()) / 86_400_000) + 1
  return `${occ.metadata.title} (Day ${dayIdx}/${days})`
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
// EXPANSION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Typed engine input — structural fields are concrete; domain metadata is
 * nested under `metadata` rather than spread flat. This separation is what
 * allows the index signature to be removed.
 *
 * Structural fields drive all expansion logic:
 *   - `date` / `time` — anchor read by nodeDateTime.
 *   - `repeat`        — discriminated-union narrowing.
 *   - `excluded`      — suppresses an occurrence.
 *   - `instances`     — recursive child array.
 *
 * All domain fields (done, priority, duration, participants, timezone) live
 * under `metadata` and are transparent to the engine — they flow through
 * unchanged to the ExpandedOcc output.
 */
interface ExpandNode {
  date:       string
  time:       string | null
  repeat?:    Repeat
  excluded?:  boolean
  instances?: ExpandNode[]
  metadata:   OccurrenceMetadata
}

/** One resolved occurrence emitted by the engine, before file-meta join. */
interface ExpandedOcc {
  date:      string
  time:      string | null
  jsTime:    Date
  excluded?: boolean
  metadata:  OccurrenceMetadata
}

const WDAYS_MAP: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 }

function mergeNode(parent: ExpandNode, child: ExpandNode): ExpandNode {
  return {
    date:      child.date || parent.date,
    time:      child.time ?? parent.time,
    repeat:    child.repeat ?? parent.repeat,
    excluded:  child.excluded ?? parent.excluded,
    instances: parent.instances,
    metadata:  { ...parent.metadata, ...child.metadata },
  }
}

function generateScheduledDates(
  anchor: Date,
  anchorTimeStr: string | null,
  sched: Extract<Repeat, { type: 'schedule' }>,
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
      const tm = anchorTimeStr.match(/^(\d{1,2}):(\d{2})/)
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
        const targetDays = byweekday.map(d => WDAYS_MAP[d.toLowerCase()] ?? 0)
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

function expandNode(
  node: ExpandNode,
  from: Date,
  to: Date,
): ExpandedOcc[] {
  const occurrences: ExpandedOcc[] = []
  const anchor = nodeDateTime(node)
  if (!anchor) return occurrences

  const instanceOverrides = (node.instances ?? []).map(child => {
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
  }).filter((o): o is NonNullable<typeof o> => o !== null)

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

  function makeOcc(eff: ExpandNode, jsDate: Date, baseNode: ExpandNode, instOverride: { child: ExpandNode } | null): ExpandedOcc | null {
    if (eff.excluded) return null
    const occTimeStr = eff.time ?? baseNode.time ?? node.time
    const occDate = (instOverride?.child.date && instOverride.child.date !== node.date)
      ? instOverride.child.date
      : (jsDateToSpec(jsDate).date ?? '')
    return { date: occDate, time: occTimeStr, jsTime: jsDate, metadata: eff.metadata }
  }

  if (node.repeat?.type !== 'after_completion') {
    if (anchor >= from && anchor <= to) {
      const ov = findOverride(anchor)
      const occ = makeOcc(ov ? ov.eff : node, anchor, node, ov)
      if (occ) occurrences.push(occ)
    }
  }

  if (!node.repeat) return occurrences

  const repeat = node.repeat

  if (repeat.type === 'schedule') {
    const generated = generateScheduledDates(anchor, node.time, repeat, from, to)
    const generatedMs = new Set(generated.map(d => d.getTime()))
    generatedMs.add(anchor.getTime())

    for (const genDate of generated) {
      const ov = findOverride(genDate)
      const occ = makeOcc(ov ? ov.eff : node, genDate, node, ov)
      if (occ) occurrences.push(occ)
    }

    for (const inst of node.instances ?? []) {
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
          occurrences.push({
            date: inst.date || (jsDateToSpec(t).date ?? ''),
            time: eff.time,
            jsTime: t,
            metadata: eff.metadata,
          })
        }
      }
    }
  } else if (repeat.type === 'after_completion') {
    const allTimes: Array<{ jsTime: Date; done: boolean | undefined; priority: Priority | undefined }> = []
    const anchorInst = (node.instances ?? []).find(i => {
      const t = nodeDateTime(i) || parseDateString(i.date)
      return t && Math.abs(t.getTime() - anchor.getTime()) < 60000
    })
    if (!anchorInst?.excluded) {
      allTimes.push({
        jsTime:   anchor,
        done:     anchorInst !== undefined ? anchorInst.metadata.done : node.metadata.done,
        priority: anchorInst?.metadata.priority ?? node.metadata.priority,
      })
    }
    for (const inst of node.instances ?? []) {
      const t = nodeDateTime(inst) || parseDateString(inst.date)
      if (!t || inst.excluded) continue
      if (Math.abs(t.getTime() - anchor.getTime()) < 60000) continue
      allTimes.push({ jsTime: t, done: inst.metadata.done, priority: inst.metadata.priority ?? node.metadata.priority })
    }
    allTimes.sort((a, b) => a.jsTime.getTime() - b.jsTime.getTime())

    for (const entry of allTimes) {
      if (entry.jsTime >= from && entry.jsTime <= to) {
        const spec = jsDateToSpec(entry.jsTime)
        occurrences.push({
          date:     spec.date ?? '',
          time:     spec.time ?? node.time,
          jsTime:   entry.jsTime,
          metadata: { ...node.metadata, done: entry.done, priority: entry.priority },
        })
      }
    }
    const lastDone = [...allTimes].reverse().find(e => e.done === true)
    if (lastDone) {
      const nextJsTime = addInterval(lastDone.jsTime, String(repeat.interval || '1 day'))
      const alreadyExists = allTimes.some(e => Math.abs(e.jsTime.getTime() - nextJsTime.getTime()) < 60000)
      const isExcluded = (node.instances ?? []).some(inst => {
        if (!inst.excluded) return false
        const t = parseDateString(inst.date)
        return t !== null && Math.abs(t.getTime() - nextJsTime.getTime()) < 60000
      })
      if (!alreadyExists && !isExcluded && nextJsTime >= from && nextJsTime <= to) {
        const spec = jsDateToSpec(nextJsTime)
        occurrences.push({
          date:     spec.date ?? '',
          time:     spec.time ?? node.time,
          jsTime:   nextJsTime,
          metadata: { ...node.metadata, done: false },
        })
      }
    }
  }

  for (const child of node.instances ?? []) {
    if (child.repeat) {
      const effChild = mergeNode(node, child)
      occurrences.push(...expandNode({ ...effChild, instances: [] }, from, to))
    }
  }

  return occurrences
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A concrete resolved occurrence (single point in time).
 * `T` is the metadata type defined by the caller.
 */
export interface OccurrenceEntry<T = Record<string, unknown>> {
  date:      string                    // YYYY-MM-DD
  time:      string | null             // HH:mm or null
  source:    'generated' | 'explicit'
  fileSlug:  string                    // identifies source file (= node.id)
  id:        string                    // stable UUID — carried from the store item or memoised by logical key
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

export function treeHasOccurrences(node: EffectiveNode): boolean {
  if (hasRepeat(node) || node.fields.date !== undefined) return true
  return node.instances.some(treeHasOccurrences)
}

// ─────────────────────────────────────────────────────────────────────────────
// STABLE ID MEMO
// ─────────────────────────────────────────────────────────────────────────────

// Series-generated occurrences have no backing store row, so we memo their id
// by logical key. The same (ownerId, date, time) always resolves to the same
// UUID within a session, making occ.id stable across re-expansions.
const occIdCache = new Map<string, string>()
export function stableOccId(key: string): string {
  let id = occIdCache.get(key)
  if (!id) { id = crypto.randomUUID(); occIdCache.set(key, id) }
  return id
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPANDRANGE  (main-app entry point — takes StoreItem[])
// ─────────────────────────────────────────────────────────────────────────────

/** Merge file-level root fields (title/tags/topics/body) with occurrence metadata. */
export function joinFileMeta(fileSlug: string, meta: OccurrenceMetadata, roots: Roots): AppMetadata {
  return {
    ...(roots.get(fileSlug) ?? { title: '', tags: [], topics: [] }),
    ...meta,
  }
}

/**
 * Expand StoreItem[] in the date range [from, to].
 * Series items are expanded via their repeat rule; standalone OccurrenceEntry
 * items are emitted directly if they fall in range.
 * Each output occurrence carries ownerId = series.id so the editor can detect
 * recurring items and look up the parent series.
 * File-level fields (title/tags/topics/body) are joined from `roots`.
 */
export function expandRange(
  items: StoreItem[],
  roots: Roots,
  from: Date,
  to: Date,
): OccurrenceEntry<AppMetadata>[] {
  const result: OccurrenceEntry<AppMetadata>[] = []

  const seriesList = items.filter(isSeries) as StoreSeries[]
  // Standalone = non-series items with no ownerId
  const standalones = items.filter(isStandaloneOcc)

  // ── Expand each series ────────────────────────────────────────────────────
  for (const series of seriesList) {
    const children = items.filter(
      i => !isSeries(i) && (i as StoreOcc).ownerId === series.id,
    ) as StoreOcc[]

    const expandable: ExpandNode = {
      date:     series.date,
      time:     series.time,
      repeat:   series.repeat,
      metadata: series.metadata,
      instances: children.map(c => ({
        date:     c.date,
        time:     c.time ?? null,
        excluded: c.excluded,
        metadata: c.metadata,
      })),
    }

    const genDates = generatedDateSet(expandable, from, to)
    const raw = expandNode(expandable, from, to)

    for (const occ of raw) {
      const { jsTime } = occ
      const isGenerated = genDates.has(occ.date)

      // Find an explicit override whose date matches this occurrence
      const override = children.find(c => {
        const ct = nodeDateTime({ date: c.date, time: c.time }) || parseDateString(c.date)
        return ct && Math.abs(ct.getTime() - jsTime.getTime()) < 60000
      })

      const occMeta: OccurrenceMetadata = override
        ? { ...series.metadata, ...override.metadata }
        : series.metadata
      result.push({
        date:    occ.date,
        time:    occ.time,
        source:  isGenerated ? 'generated' : 'explicit',
        fileSlug: series.fileSlug,
        id:      override
          ? override.id
          : stableOccId(`${series.id}|${occ.date}|${occ.time ?? ''}`),
        ownerId: series.id,
        metadata: { ...joinFileMeta(series.fileSlug, occMeta, roots), jsTime },
      })
    }
  }

  // ── Emit standalone occurrences ───────────────────────────────────────────
  // Multi-day events emit a single occurrence on their start date, identical to
  // any other event. The span is inferred from `duration` by callers via
  // parseDurationDays / multidayCoversDate — nothing is stored in the model.
  for (const occ of standalones) {
    const jsTime = nodeDateTime({ date: occ.date, time: occ.time })
      ?? parseDateString(occ.date)
    if (!jsTime || jsTime < from || jsTime > to) continue
    result.push({
      date:    occ.date,
      time:    occ.time,
      source:  occ.source,
      fileSlug: occ.fileSlug,
      id:      occ.id,
      excluded: occ.excluded,
      metadata: { ...joinFileMeta(occ.fileSlug, occ.metadata, roots), jsTime },
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

/**
 * Collect standalone occurrences that carry no date (e.g. a task or note saved
 * without scheduling). These never surface in the date-windowed expandRange
 * output, but they are real persisted items and must stay searchable/editable.
 * File-level fields (title/tags/body) are joined on from the per-file root node.
 */
export function collectUndated(items: StoreItem[], roots: Roots): OccurrenceEntry<AppMetadata>[] {
  const undated = items.filter(
    i => !isSeries(i)
      && !(i as OccurrenceEntry<AppMetadata>).ownerId
      && !i.date,
  ) as OccurrenceEntry<AppMetadata>[]
  return undated.map(occ => ({
    ...occ,
    metadata: joinFileMeta(occ.fileSlug, occ.metadata, roots),
  }))
}

/**
 * Like expandRange, but also generates a virtual occurrence for every
 * subsequent day that a multi-day standalone event covers within [from, to].
 * The start-date occurrence is already produced by expandRange; this helper
 * adds days 2..N so callers don't need to scatter that logic across views.
 * Result is deduplicated by (fileSlug, jsTime) and sorted by jsTime.
 */
export function expandWithMultiday(
  items: StoreItem[],
  roots: Roots,
  from: Date,
  to: Date,
): OccurrenceEntry<AppMetadata>[] {
  const occs = expandRange(items, roots, from, to)

  const extraMultiday = items
    .filter(isStandaloneOcc)
    .flatMap(i => {
      const days = parseDurationDays(i.metadata.duration)
      if (!days || days < 2) return []
      const startD = parseDateString(i.date)
      if (!startD) return []
      const extras: OccurrenceEntry<AppMetadata>[] = []
      for (let d = 1; d < days; d++) {
        const coveredDate = new Date(startD.getTime() + d * 86_400_000)
        coveredDate.setHours(0, 0, 0, 0)
        if (coveredDate < from || coveredDate > to) continue
        extras.push({
          ...i,
          source: 'explicit' as const,
          metadata: { ...joinFileMeta(i.fileSlug, i.metadata, roots), jsTime: coveredDate },
        })
      }
      return extras
    })

  const seen = new Set<string>()
  return [...occs, ...extraMultiday]
    .filter(o => {
      if (!o.metadata.jsTime) return false
      const k = `${o.fileSlug}|${o.metadata.jsTime.getTime()}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => (a.metadata.jsTime?.getTime() ?? 0) - (b.metadata.jsTime?.getTime() ?? 0))
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL  (used only within this file)
// ─────────────────────────────────────────────────────────────────────────────

function generatedDateSet(expandable: ExpandNode, from: Date, to: Date): Set<string> {
  const noInsts: ExpandNode = { ...expandable, instances: [] }
  const raw = expandNode(noInsts, from, to)
  return new Set(raw.map(o => o.date))
}
