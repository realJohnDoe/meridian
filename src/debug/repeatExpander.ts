/**
 * Repeat expansion bridge for the Node Inheritance Debugger.
 *
 * expandNode() in recurrence.ts expects the NESTED repeat format:
 *   { type: 'schedule', scheduled: { freq, byweekday, ... } }
 *
 * Raw YAML nodes use the FLAT format:
 *   { type: 'schedule', freq: 'weekly', byweekday: ['mo'] }
 *
 * This module normalises flat → nested before delegating to expandNode.
 */

import { expandNode } from '../recurrence'
import type { RawNode } from './nodeSchema'

export interface OccurrenceEntry {
  date: string
  time: string | null
  title: string | null
  done: boolean | undefined
  /** True for the first occurrence (the anchor / node's own date). */
  isAnchor: boolean
}

// ── Format normaliser ─────────────────────────────────────────────────────────

/**
 * Convert a flat `repeat` dict to the nested format expected by expandNode.
 *
 * Flat  (raw YAML):   { type: 'schedule', freq: 'weekly', byweekday: ['mo'] }
 * Nested (required):  { type: 'schedule', scheduled: { freq: 'weekly', byweekday: ['mo'] } }
 */
function normalizeRepeat(repeat: Record<string, unknown>): Record<string, unknown> {
  if (repeat.type !== 'schedule') return repeat
  if (repeat.scheduled)          return repeat   // already nested

  const { type, ...schedFields } = repeat
  return { type, scheduled: schedFields }
}

/**
 * Return a shallow copy of the node with the repeat field normalised (if needed).
 * All other fields, including `instances`, are preserved for expandNode.
 */
function normalizeNode(node: RawNode): Record<string, unknown> {
  const n: Record<string, unknown> = { ...node }
  const repeat = n.repeat
  if (
    repeat &&
    typeof repeat === 'object' &&
    !Array.isArray(repeat) &&
    (repeat as Record<string, unknown>).type === 'schedule' &&
    !(repeat as Record<string, unknown>).scheduled
  ) {
    n.repeat = normalizeRepeat(repeat as Record<string, unknown>)
  }
  return n
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Expand the repeat schedule of a raw node up to `endDateStr` (YYYY-MM-DD).
 *
 * Returns an empty array when:
 *  - `endDateStr` is not a valid date
 *  - the node has no `date` field (no anchor)
 *  - the node has no `repeat` field (caller should detect this separately)
 */
export function expandRepeat(
  node: RawNode,
  endDateStr: string,
): OccurrenceEntry[] {
  const normalized = normalizeNode(node)

  // Use epoch as the lower bound so the anchor is always included
  const from = new Date(0)
  const to   = new Date(`${endDateStr}T23:59:59`)
  if (isNaN(to.getTime())) return []

  // expandNode is @ts-nocheck duck-typed — cast accordingly
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = expandNode(normalized as any, from, to) as Record<string, unknown>[]

  return raw.map((occ, i) => ({
    date:     String(occ.date ?? ''),
    time:     occ.time  ? String(occ.time)  : null,
    title:    occ.title ? String(occ.title) : null,
    done:     occ.done as boolean | undefined,
    isAnchor: i === 0,
  }))
}

/** True if the node has a `repeat` field at all. */
export function hasRepeat(node: RawNode): boolean {
  return node.repeat !== undefined && node.repeat !== null
}
