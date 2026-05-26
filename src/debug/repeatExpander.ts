/**
 * Repeat expansion bridge for the Node Inheritance Debugger.
 *
 * Accepts an EffectiveNode (post-inheritance) and expands its repeat schedule
 * into a flat list of concrete occurrences.
 *
 * NOTE: This is a temporary bridge that delegates to the existing expandNode()
 * in recurrence.ts via a duck-typed adapter. It will be replaced by the full
 * per-pattern pipeline (extractRepeatSeries / expandPattern / mergeAllPools)
 * once that architecture is implemented.
 *
 * Key format difference handled here:
 *   Raw YAML (flat):   repeat: { type: schedule, freq: weekly, byweekday: [mo] }
 *   expandNode expects: repeat: { type: schedule, scheduled: { freq, byweekday, ... } }
 */

import { expandNode } from '../recurrence'
import type { EffectiveNode } from './inheritance'

// ── Public types ──────────────────────────────────────────────────────────────

export interface OccurrenceEntry {
  date:  string
  time:  string | null
  title: string | null
  done:  boolean | undefined
}

// ── Format normaliser ─────────────────────────────────────────────────────────

/**
 * Convert flat repeat format to the nested format expected by expandNode.
 *
 * Flat  (raw YAML):    { type: 'schedule', freq: 'weekly', byweekday: ['mo'] }
 * Nested (required):   { type: 'schedule', scheduled: { freq: 'weekly', byweekday: ['mo'] } }
 */
function normalizeRepeat(repeat: Record<string, unknown>): Record<string, unknown> {
  if (repeat.type !== 'schedule') return repeat
  if (repeat.scheduled)           return repeat   // already nested
  const { type, ...schedFields } = repeat
  return { type, scheduled: schedFields }
}

/**
 * Build a duck-typed node suitable for expandNode() from an EffectiveNode.
 * Reconstructs a shallow `instances` array from the effective children.
 */
function toExpandable(node: EffectiveNode): Record<string, unknown> {
  const fields = { ...node.fields }

  // Normalise the repeat field if present
  if (fields.repeat && typeof fields.repeat === 'object' && !Array.isArray(fields.repeat)) {
    fields.repeat = normalizeRepeat(fields.repeat as Record<string, unknown>)
  }

  // Shallow instances — expandNode only needs date/time/excluded/done on children
  fields.instances = node.instances.map(child => ({ ...child.fields }))

  return fields
}

// ── Public API ────────────────────────────────────────────────────────────────

/** True if the effective node has a `repeat` field. */
export function hasRepeat(node: EffectiveNode): boolean {
  return node.fields.repeat !== undefined && node.fields.repeat !== null
}

/**
 * Expand the repeat schedule of an effective node up to `endDateStr` (YYYY-MM-DD).
 * Returns an empty array when the node has no `date`, or `endDateStr` is invalid.
 */
export function expandRepeat(node: EffectiveNode, endDateStr: string): OccurrenceEntry[] {
  const expandable = toExpandable(node)

  const from = new Date(0)
  const to   = new Date(`${endDateStr}T23:59:59`)
  if (isNaN(to.getTime())) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = expandNode(expandable as any, from, to) as Record<string, unknown>[]

  return raw.map(occ => ({
    date:  String(occ.date  ?? ''),
    time:  occ.time  ? String(occ.time)  : null,
    title: occ.title ? String(occ.title) : null,
    done:  occ.done as boolean | undefined,
  }))
}
