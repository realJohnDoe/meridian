/**
 * Inheritance-aware expansion entry point.
 *
 * All main-app code that previously imported from `../recurrence` should
 * import from here instead. Date helpers and low-level functions are
 * re-exported unchanged; only `expandRange` is replaced with a version that
 * runs `defaults:`-driven inheritance before handing off to the recurrence engine.
 */

// ── Re-exports (call sites need not change) ───────────────────────────────────

export {
  fmtISO,
  fmtT,
  parseDateString,
  toDate,
  nodeDateTime,
  jsDateToSpec,
  addInterval,
  parseDurationHours,
  mergeNode,
  expandNode,
} from '../recurrence'

// ── Inheritance-aware expandRange ─────────────────────────────────────────────

import {
  parseDateString as _parseDateString,
  nodeDateTime    as _nodeDateTime,
  jsDateToSpec    as _jsDateToSpec,
  expandNode      as _expandNode,
  mergeNode       as _mergeNode,
} from '../recurrence'
import { buildEffectiveTree } from './inheritance'
import type { RawNode }       from './nodeSchema'

/**
 * Expand `nodes` in the date range [from, to], applying `defaults:`-driven
 * inheritance before generating occurrences.
 *
 * Drop-in replacement for `expandRange` from recurrence.ts.
 */
export function expandRange(
  nodes: unknown[],
  from: Date,
  to:   Date,
): unknown[] {
  const addDays = (d: Date, n: number) => {
    const r = new Date(d)
    r.setDate(r.getDate() + n)
    return r
  }

  const all: unknown[] = []

  for (const rawNode of nodes) {
    // Resolve defaults: inheritance — produces a flat EffectiveNode tree
    const effective = buildEffectiveTree(rawNode as RawNode)

    // Flatten the effective tree back to a plain object for the recurrence engine
    const node = {
      ...effective.fields,
      instances: effective.instances.map(child => ({ ...child.fields })),
    } as Record<string, unknown>

    if (node.multiday) {
      const md = node.multiday as { start?: string; end?: string }
      let d = _parseDateString((md.start || node.date) as string)
      if (!d) continue
      d = new Date(d); d.setHours(0, 0, 0, 0)
      const endD = _parseDateString(md.end as string)
      if (!endD) continue
      const endDt = new Date(endD); endDt.setHours(23, 59, 59)
      while (d <= endDt) {
        if (d >= from && d <= to) {
          const spec = _jsDateToSpec(d)
          all.push({ ...node, date: spec.date, time: null, jsTime: new Date(d), _nodeId: (rawNode as Record<string, unknown>).id, _node: rawNode, recur: false })
        }
        d = addDays(d, 1)
      }
    } else if (node.repeat) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      all.push(...(_expandNode(node as any, from, to) as unknown[]))
    } else {
      // Container node: instances that carry their own `repeat` (debugger split pattern).
      // Each such child is merged with the parent and expanded independently.
      const repeatInstances = ((node.instances as unknown[]) || []).filter(
        (i: unknown) => !!(i as Record<string, unknown>).repeat && !(i as Record<string, unknown>).excluded,
      )
      for (const inst of repeatInstances) {
        const effChild = _mergeNode(node, inst) as Record<string, unknown>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        all.push(...(_expandNode({ ...effChild, instances: [] } as any, from, to) as unknown[]))
      }

      // Non-recurring instances (standard multi-occurrence or single-date node)
      const liveInstances = ((node.instances as unknown[]) || []).filter(
        (i: unknown) => !(i as Record<string, unknown>).excluded && !(i as Record<string, unknown>).repeat,
      )
      if (liveInstances.length > 0) {
        for (const inst of liveInstances) {
          const it = _nodeDateTime(inst) || _parseDateString((inst as Record<string, unknown>).date as string)
          if (!it || it < from || it > to) continue
          const eff = _mergeNode(node, inst)
          if (!eff.excluded) {
            all.push({
              ...eff,
              date: (inst as Record<string, unknown>).date || _jsDateToSpec(it).date,
              jsTime: it,
              _nodeId: (rawNode as Record<string, unknown>).id,
              _node: rawNode,
              recur: true,
            })
          }
        }
      } else if (repeatInstances.length === 0) {
        // Pure single-date node with no instances at all
        const t = _nodeDateTime(node)
        if (t && t >= from && t <= to) {
          all.push({ ...node, jsTime: t, _nodeId: (rawNode as Record<string, unknown>).id, _node: rawNode, recur: false })
        }
      }
    }
  }

  const seen = new Set<string>()
  return (all as Record<string, unknown>[])
    .filter(o => {
      if (!o.jsTime) return false
      const k = `${o._nodeId || o.title}|${(o.jsTime as Date).getTime()}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => (a.jsTime as Date).getTime() - (b.jsTime as Date).getTime())
}
