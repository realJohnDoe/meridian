/**
 * Shared node-edit logic used by both the main app (saveNode in meridian.ts)
 * and the debug view (NodeInheritanceDebugger.tsx).
 *
 * All functions are pure: they return a new RawNode without mutating inputs.
 */

import type { RawNode } from './model/nodeSchema'
import { splitNode, getSubNode } from './model/nodeOps'
import { canonicaliseInstance } from './model/inheritance'
import type { EntryState } from './components/EntryEditor'
import type { Occurrence } from './types'

// ── Domain key sets ───────────────────────────────────────────────────────────

/** Fields that always stay as direct fields on a series node. */
export const SERIES_STRUCTURAL: ReadonlySet<string> =
  new Set(['date', 'time', 'repeat', 'instances', 'defaults'])

/** Fields that stay direct (not in nested defaults) when they differ from root. */
export const SERIES_DIRECT: ReadonlySet<string> = new Set(['title'])

// ── Core edit function ────────────────────────────────────────────────────────

/**
 * Apply editor form fields to a rawNode and return the updated rawNode.
 *
 * Handles all four edit scopes:
 *   'all'    — edit every occurrence of the series
 *   'single' — override one occurrence via an instances entry
 *   'future' — split the series at this occurrence, editing this & all following
 *   'add'    — append a new explicit occurrence (also migrates root date when needed)
 *
 * Uses effective (inherited) values from occ.metadata for comparisons — not root
 * node fields — so diffs are correct even when values come from a defaults: block.
 */
export function applyNodeEdit(rawNode: RawNode, entry: EntryState, body: string): RawNode {
  const { item, editScope, title, tags, tracked, done, priority, scheduled, duration, repeat } = entry
  if (!item) return rawNode
  const occ      = item as Occurrence
  const occDate  = occ.date
  const ownerPath: number[] = occ.ownerPath ?? []
  const n = rawNode as Record<string, unknown>

  // ── edit whole series ──────────────────────────────────────────────────────
  if (editScope === 'all') {
    const updated = { ...n }
    updated.title = title
    if (tags?.length) updated.tags = tags; else delete updated.tags
    if (body) updated.body = body; else delete updated.body
    if (tracked) { updated.done = done; if (priority) updated.priority = priority; else delete updated.priority }
    else { delete updated.done; delete updated.priority }
    if (scheduled?.date) { updated.date = scheduled.date; if (scheduled.time) updated.time = scheduled.time; else delete updated.time }
    if (duration) updated.duration = duration; else delete updated.duration
    if (repeat) updated.repeat = repeat as unknown; else delete updated.repeat
    return updated as RawNode

  // ── single occurrence override ─────────────────────────────────────────────
  } else if (editScope === 'single') {
    const instances = [...((n.instances as RawNode[]) ?? [])]
    const idx  = instances.findIndex(i => String((i as Record<string, unknown>).date) === occDate)
    const base: Record<string, unknown> = idx >= 0 ? { ...(instances[idx] as object) } : { date: occDate }
    if (scheduled?.time) base.time = scheduled.time; else delete base.time

    // Compare against effective inherited values — not the root node title
    const m = occ.metadata
    if (title !== m.title) base.title = title; else delete base.title
    if (duration !== (m.duration || '')) base.duration = duration; else delete base.duration
    if (body !== (m.body || '')) base.body = body; else delete base.body

    const origTagsStr = JSON.stringify(m.tags ?? [])
    if (tags?.length && JSON.stringify(tags) !== origTagsStr) base.tags = tags
    else delete base.tags

    if (tracked) {
      base.done = done
      if (priority && priority !== m.priority) base.priority = priority
      else delete base.priority
    } else {
      delete base.done
      delete base.priority
    }

    if (idx >= 0) instances[idx] = base as RawNode; else instances.push(base as RawNode)
    return { ...rawNode, instances } as RawNode

  // ── split: this & all following ────────────────────────────────────────────
  } else if (editScope === 'future') {
    const origRepeat = (getSubNode(rawNode, ownerPath) as Record<string, unknown> | undefined)?.repeat

    function buildSeries(rootDefs: Record<string, unknown>): Record<string, unknown> {
      const flatSeries: Record<string, unknown> = {
        date:  scheduled?.date || occDate,
        ...(scheduled?.time ? { time: scheduled.time } : {}),
        ...((repeat ?? origRepeat) ? { repeat: repeat ?? origRepeat } : {}),
        title,
        ...(tags?.length ? { tags } : {}),
        ...(tracked ? { done, ...(priority ? { priority } : {}) } : {}),
        ...(body ? { body } : {}),
        ...(duration ? { duration } : {}),
      }
      return canonicaliseInstance(flatSeries, rootDefs, SERIES_STRUCTURAL, SERIES_DIRECT)
    }

    if (ownerPath.length === 0) {
      // Root owns the repeat — compute shared identity fields for the new container's defaults:
      const OCCURRENCE_STATE = new Set(['done', 'priority', 'body', 'duration'])
      const rootDefs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(n)) {
        if (SERIES_STRUCTURAL.has(k) || OCCURRENCE_STATE.has(k)) continue
        rootDefs[k] = v
      }
      const [series1raw] = splitNode(rawNode, occDate)
      const series1 = canonicaliseInstance(series1raw as Record<string, unknown>, rootDefs, SERIES_STRUCTURAL, SERIES_DIRECT)
      const series2 = buildSeries(rootDefs)
      return { defaults: rootDefs, instances: [series1, series2] } as unknown as RawNode

    } else {
      // A child series owns the repeat — preserve root defaults exactly.
      const rootDefs = (n.defaults as Record<string, unknown> | undefined) ?? {}
      const rawInstances = [...((n.instances as Record<string, unknown>[]) ?? [])]
      const sub     = rawInstances[ownerPath[0]] as Record<string, unknown>
      const subDate = String(sub?.date || '')
      const series2 = buildSeries(rootDefs)

      let newInstances: Record<string, unknown>[]
      if (occDate <= subDate) {
        // Editing at/before the series start → replace the whole series.
        newInstances = [...rawInstances]
        newInstances[ownerPath[0]] = series2
      } else {
        // Mid-series → cap the existing series and insert the new one after it.
        const [series1raw] = splitNode(sub as RawNode, occDate)
        const series1 = canonicaliseInstance(series1raw as Record<string, unknown>, rootDefs, SERIES_STRUCTURAL, SERIES_DIRECT)
        newInstances = [...rawInstances]
        newInstances.splice(ownerPath[0], 1, series1, series2)
      }
      return { ...n, instances: newInstances } as unknown as RawNode
    }

  // ── add a new occurrence ───────────────────────────────────────────────────
  } else if (editScope === 'add') {
    const rawInst = rawNode as Record<string, unknown>
    const instances = [...((rawInst.instances as RawNode[]) ?? [])]

    // For non-recurring nodes: migrate root date into instances so all occurrences
    // are explicit in the YAML (root node.date stays as metadata).
    if (!rawInst.repeat && rawInst.date) {
      const alreadyCovered = instances.some(
        i => String((i as Record<string, unknown>).date) === String(rawInst.date) &&
             !(i as Record<string, unknown>).excluded,
      )
      if (!alreadyCovered) {
        const rootInst: Record<string, unknown> = { date: rawInst.date }
        if (rawInst.time) rootInst.time = rawInst.time
        instances.unshift(rootInst as RawNode)
      }
    }

    const newInst: Record<string, unknown> = { date: scheduled?.date || occDate }
    if (scheduled?.time) newInst.time = scheduled.time
    if (title) newInst.title = title
    if (duration) newInst.duration = duration
    if (tracked) { newInst.done = done; if (priority) newInst.priority = priority }
    instances.push(newInst as RawNode)
    return { ...rawNode, instances } as RawNode
  }

  return rawNode
}

/**
 * True when the save result should be collapsed (shared fields hoisted to root defaults).
 * Only the root-split future case benefits; child-split already has the correct structure.
 */
export function shouldCollapse(entry: EntryState): boolean {
  if (entry.editScope !== 'future') return true
  const ownerPath = ((entry.item as Occurrence)?.ownerPath as number[] | undefined) ?? []
  return ownerPath.length === 0
}
