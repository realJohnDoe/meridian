/**
 * Repeat expansion bridge for the Node Inheritance Debugger.
 *
 * Accepts an EffectiveNode (post-inheritance) and expands its repeat schedule
 * into a flat list of concrete occurrences.
 *
 * NOTE: Temporary bridge delegating to the existing expandNode() in recurrence.ts.
 * Will be replaced by the full per-pattern pipeline once that architecture lands.
 */

import { expandNode } from '../recurrence'
import type { EffectiveNode } from './inheritance'

// ── Public types ──────────────────────────────────────────────────────────────

export interface OccurrenceEntry {
  date:   string
  time:   string | null
  title:  string | null
  done:   boolean | undefined
  /**
   * 'generated' — produced by the repeat schedule (may also have an instance override).
   * 'explicit'  — comes from a standalone instance not on the schedule.
   */
  source: 'generated' | 'explicit'
}

// ── Format normaliser ─────────────────────────────────────────────────────────

/**
 * Convert flat repeat format to the nested format expected by expandNode.
 *
 * Flat  (raw YAML):   { type: 'schedule', freq: 'weekly', byweekday: ['mo'] }
 * Nested (required):  { type: 'schedule', scheduled: { freq, byweekday, ... } }
 */
function normalizeRepeat(repeat: Record<string, unknown>): Record<string, unknown> {
  if (repeat.type !== 'schedule') return repeat
  if (repeat.scheduled)           return repeat
  const { type, ...schedFields } = repeat
  return { type, scheduled: schedFields }
}

/** Build a duck-typed node suitable for expandNode() from an EffectiveNode. */
function toExpandable(node: EffectiveNode): Record<string, unknown> {
  const fields = { ...node.fields }
  if (fields.repeat && typeof fields.repeat === 'object' && !Array.isArray(fields.repeat)) {
    fields.repeat = normalizeRepeat(fields.repeat as Record<string, unknown>)
  }
  fields.instances = node.instances.map(child => ({ ...child.fields }))
  return fields
}

// ── Source detection ──────────────────────────────────────────────────────────

/**
 * Run the expansion without instances to collect purely schedule-generated dates.
 * Comparing these against the full expansion identifies standalone explicit instances.
 */
function generatedDateSet(expandable: Record<string, unknown>, from: Date, to: Date): Set<string> {
  const noInsts = { ...expandable, instances: [] }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = expandNode(noInsts as any, from, to) as Record<string, unknown>[]
  return new Set(raw.map(o => String(o.date ?? '')))
}

// ── Public API ────────────────────────────────────────────────────────────────

/** True if the effective node itself has a `repeat` field. */
export function hasRepeat(node: EffectiveNode): boolean {
  return node.fields.repeat !== undefined && node.fields.repeat !== null
}

/** True if any node in the effective tree has a `repeat` field. */
export function treeHasRepeat(node: EffectiveNode): boolean {
  if (hasRepeat(node)) return true
  return node.instances.some(treeHasRepeat)
}

/**
 * Expand the repeat schedule of an effective node up to `endDateStr` (YYYY-MM-DD).
 * Each occurrence is tagged with its source: 'generated' or 'explicit'.
 */
export function expandRepeat(node: EffectiveNode, endDateStr: string): OccurrenceEntry[] {
  const expandable = toExpandable(node)
  const from = new Date(0)
  const to   = new Date(`${endDateStr}T23:59:59`)
  if (isNaN(to.getTime())) return []

  const genDates = generatedDateSet(expandable, from, to)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = expandNode(expandable as any, from, to) as Record<string, unknown>[]

  return raw.map(occ => ({
    date:   String(occ.date  ?? ''),
    time:   occ.time  ? String(occ.time)  : null,
    title:  occ.title ? String(occ.title) : null,
    done:   occ.done as boolean | undefined,
    source: genDates.has(String(occ.date ?? '')) ? 'generated' : 'explicit',
  }))
}

/**
 * Walk the entire effective tree and collect occurrences from every node
 * that has a `repeat` field. Results are merged and sorted by date.
 *
 * This handles container roots (produced by "Edit this & following") where
 * `repeat` lives on child instances rather than the root itself.
 */
export function collectAllOccurrences(node: EffectiveNode, endDateStr: string): OccurrenceEntry[] {
  const results: OccurrenceEntry[] = []

  function walk(n: EffectiveNode) {
    if (hasRepeat(n)) {
      results.push(...expandRepeat(n, endDateStr))
    } else {
      // Container node — recurse into children
      n.instances.forEach(walk)
    }
  }

  walk(node)

  // Sort by date (then time) so all series appear in chronological order
  results.sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    if (d !== 0) return d
    return (a.time ?? '').localeCompare(b.time ?? '')
  })

  return results
}
