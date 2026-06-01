/**
 * Repeat expansion bridge for the Node Inheritance model.
 *
 * Accepts an EffectiveNode (post-inheritance) and expands its repeat schedule
 * into a flat list of concrete occurrences.
 *
 * Delegates to the existing expandNode() in recurrence.ts.
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
  /**
   * Path of instance indices from the root EffectiveNode to the node whose
   * `repeat` field produced this occurrence.
   * [] = root itself has `repeat`.
   * [1] = root.instances[1] has `repeat`.
   * [1, 0] = root.instances[1].instances[0] has `repeat`, etc.
   */
  ownerPath: number[]
}

// ── Expandable builder ────────────────────────────────────────────────────────

// Fields that belong to scheduling structure and must not be lifted from children.
const SCHEDULING_FIELDS = new Set(['date', 'time', 'repeat', 'instances', 'excluded', 'defaults'])

/**
 * Build a duck-typed node suitable for expandNode() from an EffectiveNode.
 *
 * Extra step: lift fields that are shared by ALL child instances but absent
 * from the parent's own fields.  This handles the case where a series node
 * stores properties inside a `defaults:` block for its override instances
 * rather than as direct fields.  Generated occurrences are semantically
 * equivalent to child instances without explicit overrides and should inherit
 * those shared defaults too.
 *
 * Only truly-shared values (identical across every child) are lifted.
 * Fields that vary between children (e.g. done: true on some, done: false on
 * others) are not lifted — their variation is an occurrence-level concern, not
 * a series-level one.
 */
function toExpandable(node: EffectiveNode): Record<string, unknown> {
  const fields = { ...node.fields }
  fields.instances = node.instances.map(child => ({ ...child.fields }))

  if (node.instances.length > 0) {
    // Collect every key seen across all child instances
    const allKeys = new Set<string>()
    for (const child of node.instances) {
      for (const key of Object.keys(child.fields)) allKeys.add(key)
    }

    for (const key of allKeys) {
      if (SCHEDULING_FIELDS.has(key) || key in fields) continue

      // Lift only when ALL children carry exactly the same value.
      const values = node.instances.map(c => c.fields[key])
      if (!values.every(v => v !== undefined)) continue
      const first = values[0]
      const allSame = values.every(v => JSON.stringify(v) === JSON.stringify(first))
      if (allSame) fields[key] = first
    }
  }

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

/** True if any node in the effective tree would produce at least one occurrence. */
export function treeHasOccurrences(node: EffectiveNode): boolean {
  if (hasRepeat(node) || node.fields.date !== undefined) return true
  return node.instances.some(treeHasOccurrences)
}

/**
 * Expand the repeat schedule of an effective node up to `endDateStr` (YYYY-MM-DD).
 * Each occurrence is tagged with its source and the given ownerPath.
 */
export function expandRepeat(node: EffectiveNode, endDateStr: string, ownerPath: number[] = []): OccurrenceEntry[] {
  const expandable = toExpandable(node)
  const from = new Date(0)
  const to   = new Date(`${endDateStr}T23:59:59`)
  if (isNaN(to.getTime())) return []

  const genDates = generatedDateSet(expandable, from, to)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = expandNode(expandable as any, from, to) as Record<string, unknown>[]

  return raw.map(occ => ({
    date:      String(occ.date  ?? ''),
    time:      occ.time  ? String(occ.time)  : null,
    title:     occ.title ? String(occ.title) : null,
    done:      occ.done as boolean | undefined,
    source:    genDates.has(String(occ.date ?? '')) ? 'generated' : 'explicit',
    ownerPath,
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

  const to = new Date(`${endDateStr}T23:59:59`)

  function walk(n: EffectiveNode, path: number[]) {
    if (hasRepeat(n)) {
      results.push(...expandRepeat(n, endDateStr, path))
    } else if (n.fields.date !== undefined) {
      // Single occurrence — emit as one explicit entry (if within the window)
      const dateStr = String(n.fields.date)
      const d = new Date(`${dateStr}T00:00:00`)
      if (!isNaN(d.getTime()) && d <= to) {
        results.push({
          date:      dateStr,
          time:      n.fields.time  ? String(n.fields.time)  : null,
          title:     n.fields.title ? String(n.fields.title) : null,
          done:      n.fields.done as boolean | undefined,
          source:    'explicit' as const,
          ownerPath: path,
        })
      }
    } else {
      // Pure container — recurse into children
      n.instances.forEach((child, i) => walk(child, [...path, i]))
    }
  }

  walk(node, [])

  // Sort by date (then time) so all series appear in chronological order
  results.sort((a, b) => {
    const d = a.date.localeCompare(b.date)
    if (d !== 0) return d
    return (a.time ?? '').localeCompare(b.time ?? '')
  })

  return results
}
