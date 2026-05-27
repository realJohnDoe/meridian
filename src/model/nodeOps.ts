/**
 * Pure operations on RawNode trees — shared by the debugger and the main app.
 *
 * All functions are immutable: they return new objects without mutating inputs.
 */

import type { RawNode } from './nodeSchema'

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Returns the ISO date string for the day before `dateStr`. */
export function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Sub-node navigation ───────────────────────────────────────────────────────

/** Navigate to the sub-node at the given instance-index path. */
export function getSubNode(node: RawNode, path: number[]): RawNode {
  let cur = node
  for (const i of path) cur = ((cur.instances as RawNode[]) ?? [])[i]
  return cur
}

/** Immutably replace the sub-node at the given path and return the updated root. */
export function setSubNode(root: RawNode, path: number[], updated: RawNode): RawNode {
  if (path.length === 0) return updated
  const [head, ...tail] = path
  const instances = [...((root.instances as RawNode[]) ?? [])]
  instances[head] = setSubNode(instances[head], tail, updated)
  return { ...root, instances }
}

// ── Series split ──────────────────────────────────────────────────────────────

/**
 * Split a single repeat-bearing node at `occDate` into two series.
 *
 * - series1 keeps the original `date` and all fields; its repeat ends the day
 *   before `occDate`; explicit instances before `occDate` are kept.
 * - series2 starts at `occDate` with the same repeat pattern (inheriting the
 *   original end, if any); explicit instances from `occDate` onwards are kept.
 *
 * The caller may override series2's `repeat` afterwards to apply edits.
 */
export function splitNode(node: RawNode, occDate: string): [RawNode, RawNode] {
  const originalRepeat = ((node.repeat ?? {}) as Record<string, unknown>)
  const allInstances   = ((node.instances ?? []) as RawNode[])

  // series1: everything from root except instances/defaults/repeat, plus capped repeat
  const series1: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'instances' || k === 'defaults' || k === 'repeat') continue
    series1[k] = v
  }
  series1.repeat = { ...originalRepeat, end: { type: 'until', date: dayBefore(occDate) } }
  const instsBefore = allInstances.filter(
    i => String((i as Record<string, unknown>).date) < occDate,
  )
  if (instsBefore.length > 0) series1.instances = instsBefore

  // series2: same fields (without date so it can be overridden), starts at occDate
  const series2: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (k === 'instances' || k === 'defaults' || k === 'repeat' || k === 'date') continue
    series2[k] = v
  }
  series2.date   = occDate
  // Keep the original repeat (including end date) so the new series inherits
  // the same bounds; the user can change it via Edit pattern.
  series2.repeat = { ...originalRepeat }
  const instsFrom = allInstances.filter(
    i => String((i as Record<string, unknown>).date) >= occDate,
  )
  if (instsFrom.length > 0) series2.instances = instsFrom

  return [series1 as RawNode, series2 as RawNode]
}

// ── Edit-following operation ──────────────────────────────────────────────────

/**
 * Apply an "edit this & following" split to a node tree.
 *
 * - When `ownerPath` is `[]` (root has the repeat): wraps the root into a
 *   container node whose only content is `instances: [series1, series2]`,
 *   stripping `date`, `time`, `repeat` from the container root.
 * - When a child has the repeat: splits the child in place and replaces it
 *   with the two series within the parent's `instances` array.
 */
export function doEditFollowing(node: RawNode, ownerPath: number[], occDate: string): RawNode {
  if (ownerPath.length === 0) {
    // Root has repeat — wrap into a container with two child series
    const [series1, series2] = splitNode(node, occDate)
    const container: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      if (['date', 'time', 'repeat', 'instances'].includes(k)) continue
      container[k] = v
    }
    container.instances = [series1, series2]
    return container as RawNode
  }

  // Child has repeat — split and flatten back into parent's instances array
  const parentPath = ownerPath.slice(0, -1)
  const childIdx   = ownerPath[ownerPath.length - 1]
  const parent     = getSubNode(node, parentPath)
  const sub        = ((parent.instances as RawNode[]) ?? [])[childIdx]
  const [series1, series2] = splitNode(sub, occDate)
  const newInstances = [...((parent.instances as RawNode[]) ?? [])]
  newInstances.splice(childIdx, 1, series1, series2)
  return setSubNode(node, parentPath, { ...parent, instances: newInstances })
}
