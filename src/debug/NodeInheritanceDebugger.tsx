import { useState, useCallback, useMemo } from 'react'
import {
  Upload, FileText, ChevronRight, ChevronLeft, AlertCircle, RotateCcw,
  CalendarDays, Plus, Pencil, Repeat, ChevronsRight, Trash2,
} from 'lucide-react'
import { RawNodeSchema, type RawNode } from '../model/nodeSchema'
import {
  buildEffectiveTree, collapseToYaml, serializeRawNode, displayValue,
  type EffectiveNode,
} from '../model/inheritance'
import { collectAllOccurrences, treeHasOccurrences, type OccurrenceEntry } from '../model/repeatExpander'
import {
  dayBefore, getSubNode, setSubNode, doEditFollowing, splitNode,
} from '../model/nodeOps'
import { yamlParse } from '../yaml'
import type { Occurrence, Node, Priority } from '../types'
import EntryEditor, { type EntryState, type ItemType } from '../components/EntryEditor'
import RepeatDialog from '../components/RepeatDialog'
import DatePickerDialog from '../components/DatePickerDialog'
import TimePickerDialog from '../components/TimePickerDialog'
import DurationDialog from '../components/DurationDialog'
import PriorityDrawer from '../components/PriorityDrawer'
import { applyScope } from '../meridian'
import { fmtISO } from '../model/expand'

// ── OccurrenceEntry → Occurrence bridge ───────────────────────────────────────

/**
 * Build a full Occurrence from an OccurrenceEntry + its rawNode.
 *
 * The OccurrenceEntry comes from collectAllOccurrences → expandRepeat, which
 * already runs the full defaults: inheritance before expansion.  So entry.title,
 * entry.done, etc. are the EFFECTIVE (inherited) values — use them as-is.
 * Only fall back to rawNode root / defaults block when the field is missing
 * from the expanded occurrence (e.g. tags, priority, body that aren't surfaced
 * by OccurrenceEntry).
 */
function toOccurrence(entry: OccurrenceEntry, rawNode: RawNode): Occurrence {
  const [y, mo, d] = entry.date.split('-').map(Number)
  const jsTime = entry.time
    ? new Date(y, mo - 1, d, +entry.time.slice(0, 2), +entry.time.slice(3, 5))
    : new Date(y, mo - 1, d)
  const ownerSub = getSubNode(rawNode, entry.ownerPath)
  const n    = rawNode as unknown as Record<string, unknown>
  const defs = (n.defaults as Record<string, unknown> | undefined) ?? {}

  // entry.title is the fully-inherited effective title from expansion.
  // Fall through root → defaults only when the expansion returned nothing.
  const title = entry.title || String(n.title ?? defs.title ?? '')

  // done: entry gives the effective value; fall back to root/defaults
  const done =
    entry.done !== undefined ? entry.done
    : n.done   !== undefined ? (n.done   as boolean)
    : defs.done !== undefined ? (defs.done as boolean)
    : undefined

  return {
    title,
    date:      entry.date,
    time:      entry.time ?? null,
    jsTime,
    done,
    // tags / priority / body are not surfaced by OccurrenceEntry;
    // read them from root then defaults (effective expansion includes them but
    // they're carried via _node so entryFromOccurrence can pick them up).
    tags:     Array.isArray(n.tags)      ? (n.tags      as string[]) :
              Array.isArray(defs.tags)   ? (defs.tags   as string[]) : [],
    type:     done !== undefined ? 'task' : 'event',
    _nodeId:  String(n.id ?? entry.title ?? 'debug-node'),
    _node:    rawNode as unknown as Node,
    ownerPath: entry.ownerPath,
    recur:    !!(ownerSub?.repeat),
    // repeat comes from the owning sub-node (not the container root)
    repeat:   ownerSub?.repeat as Occurrence['repeat'],
    body:     String(n.body ?? defs.body ?? ''),
    priority: (n.priority ?? defs.priority) as Priority | undefined,
    duration: String(n.duration ?? defs.duration ?? ''),
  } as Occurrence
}

/**
 * Build the initial EntryState when the user clicks an occurrence.
 *
 * Seeds every field from the effective occurrence — the user edits from here
 * and whatever they save becomes the new series verbatim.
 */
function entryFromOccurrence(occ: Occurrence): EntryState {
  const tracked = occ.done !== undefined
  const itemType: ItemType = tracked ? 'task' : occ.date ? 'event' : 'note'
  // repeat: use the occurrence's own repeat (ownerSub repeat), not root repeat
  const repeat  = occ.repeat ?? null
  const scheduled = occ.date ? { date: occ.date, time: occ.time || '' } : null
  return {
    item:      occ,
    title:     occ.title || '',
    bodyHtml:  String(occ.body || ''),
    scheduled,
    repeat,
    duration:  occ.duration || '',
    tracked,
    itemType,
    done:      occ.done ?? false,
    tags:      [...(occ.tags || [])],
    priority:  occ.priority || null,
    editScope: 'single',
  }
}

// ── Helpers for applyDebugSave ────────────────────────────────────────────────


/**
 * Build a new series node from editor values.
 *
 * @param rootDefs  The root-level defaults: block of the parent rawNode (may be
 *                  empty for flat nodes).  Used to determine which fields the
 *                  series already inherits and therefore doesn't need to repeat.
 * @param useNestedDefaults  When true (parent has a defaults: block OR this
 *                  series itself has a repeat:), occurrence-level properties
 *                  (done, priority overrides, tag overrides, body, duration) are
 *                  placed in a nested `defaults:` block rather than as direct
 *                  fields.  This keeps the series node clean: it only holds
 *                  `date`, `repeat`, optionally `title` (if different), and a
 *                  `defaults:` block for anything the occurrences should inherit.
 */
function buildSeriesNode(
  entry:             EntryState,
  body:              string,
  occDate:           string,
  origRepeat:        unknown,
  rootDefs:          Record<string, unknown>,
  useNestedDefaults: boolean,
): Record<string, unknown> {
  const { title, tags, tracked, done, priority, scheduled, duration, repeat } = entry

  const series: Record<string, unknown> = {}
  series.date   = scheduled?.date || occDate
  series.repeat = repeat ?? origRepeat
  if (!series.repeat) delete series.repeat
  if (scheduled?.time) series.time = scheduled.time

  // title: write directly only when it differs from the inherited root default
  const defaultTitle = String(rootDefs.title ?? '')
  if (title && title !== defaultTitle) series.title = title

  // Collect occurrence-level properties that need to be expressed on this series
  const occFields: Record<string, unknown> = {}

  if (tracked) {
    occFields.done = done
    // priority: only write if it differs from the root default
    const defaultPriority = rootDefs.priority
    if (priority && priority !== defaultPriority) occFields.priority = priority
  }

  const defaultTagsStr = JSON.stringify(
    Array.isArray(rootDefs.tags) ? rootDefs.tags : [],
  )
  if (tags?.length && JSON.stringify(tags) !== defaultTagsStr) occFields.tags = tags

  if (body)     occFields.body     = body
  if (duration) occFields.duration = duration

  if (Object.keys(occFields).length > 0) {
    if (useNestedDefaults) {
      // Series node: put occurrence properties in a nested defaults: block so
      // every generated occurrence inherits them automatically.
      series.defaults = occFields
    } else {
      // Flat / single-occurrence: write fields directly
      Object.assign(series, occFields)
    }
  }

  return series
}

// Fields that belong to the series' scheduling structure and must NEVER be
// moved into a `defaults:` block.
const SERIES_STRUCTURAL = new Set(['date', 'time', 'repeat', 'instances', 'defaults'])

/**
 * Restructure a raw series node so that every field except date / repeat /
 * title / instances lives inside a nested `defaults:` block.
 *
 * This is applied to series1 (the existing split-off series) so it matches the
 * canonical form used for series2 (built by buildSeriesNode).
 *
 * Fields already matching `rootDefs` are dropped (they will be inherited).
 * Title is kept as a direct field when it differs from rootDefs.title.
 */
function canonicaliseSeriesNode(
  raw:      Record<string, unknown>,
  rootDefs: Record<string, unknown>,
): Record<string, unknown> {
  const series: Record<string, unknown> = {}
  const nested: Record<string, unknown> = {}

  for (const [k, v] of Object.entries(raw)) {
    if (SERIES_STRUCTURAL.has(k)) {
      series[k] = v
      continue
    }
    if (k === 'title') {
      // Keep title directly on the series only if it overrides the root default
      if (String(v) !== String(rootDefs.title ?? '')) series.title = v
      continue
    }
    // Everything else: put in nested defaults unless it matches the root default
    if (JSON.stringify(v) !== JSON.stringify(rootDefs[k])) {
      nested[k] = v
    }
  }

  if (Object.keys(nested).length > 0) series.defaults = nested
  return series
}

// ── Main save logic ───────────────────────────────────────────────────────────

/**
 * Apply the editor form fields to rawNode and return the updated rawNode.
 *
 * 'future' scope semantics
 * ─────────────────────────
 * ownerPath = [] (root repeat):
 *   Split root into two series.  Compute root-level `defaults:` from fields that
 *   are structural identity (title, tags, …) but NOT scheduling or task-state.
 *   Both series1 and series2 get their occurrence-state fields (done, priority,
 *   …) placed in a nested `defaults:` block.
 *
 * ownerPath = [i] (child series):
 *   The root `defaults:` is preserved exactly as-is — untouched siblings must
 *   not receive any new explicit fields.  Only the target series is replaced /
 *   split; it and the new future series carry their unique fields in a nested
 *   `defaults:` block.
 */
function applyDebugSave(rawNode: RawNode, entry: EntryState, body: string): RawNode {
  const { item, editScope, title, tags, tracked, done, priority, scheduled, duration, repeat } = entry
  if (!item) return rawNode
  const occ      = item as Occurrence & { ownerPath?: number[] }
  const occDate  = occ.date
  const ownerPath: number[] = occ.ownerPath ?? []
  const n = rawNode as Record<string, unknown>

  // ── edit whole series ────────────────────────────────────────────────────
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

  // ── single occurrence override ───────────────────────────────────────────
  } else if (editScope === 'single') {
    const instances = [...((n.instances as RawNode[]) ?? [])]
    const idx  = instances.findIndex(i => String((i as any).date) === occDate)
    const base: Record<string, unknown> = idx >= 0 ? { ...(instances[idx] as object) } : { date: occDate }
    const origTitle = occ.title   // effective/inherited title — don't write if unchanged
    if (title !== origTitle) base.title = title; else delete base.title
    if (scheduled?.time) base.time = scheduled.time; else delete base.time
    const origDur = occ.duration
    if (duration !== origDur) base.duration = duration; else delete base.duration
    if (tracked) { base.done = done; if (priority) base.priority = priority; else delete base.priority }
    else { delete base.done; delete base.priority }
    if (body !== String((rawNode as any).body || '')) base.body = body; else delete base.body
    if (idx >= 0) instances[idx] = base as RawNode; else instances.push(base as RawNode)
    return { ...rawNode, instances } as RawNode

  // ── split: this & all following ──────────────────────────────────────────
  } else if (editScope === 'future') {
    // Original repeat for the owning series (used when user hasn't changed it).
    const origRepeat = (getSubNode(rawNode, ownerPath) as Record<string, unknown> | undefined)?.repeat

    if (ownerPath.length === 0) {
      // ── Root owns the repeat ──
      // Decide what goes to the new container's root defaults: everything that
      // is NOT scheduling-specific and NOT task/occurrence state.
      const OCCURRENCE_STATE = new Set(['done', 'priority', 'body', 'duration'])
      const rootDefs: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(n)) {
        if (SERIES_STRUCTURAL.has(k) || OCCURRENCE_STATE.has(k)) continue
        rootDefs[k] = v   // title, tags, and any other identity fields
      }

      // Split: series1 keeps everything up to occDate, capped.
      const [series1raw] = splitNode(rawNode, occDate)
      const series1 = canonicaliseSeriesNode(series1raw as Record<string, unknown>, rootDefs)

      // series2 is built entirely from editor values.
      const series2 = buildSeriesNode(entry, body, occDate, origRepeat, rootDefs, true)

      return { defaults: rootDefs, instances: [series1, series2] } as unknown as RawNode

    } else {
      // ── A child series owns the repeat ──
      // Preserve the root `defaults:` exactly.  Untouched siblings must not gain
      // any explicit fields — we work directly on the raw node, no promotion.
      const rootDefs = (n.defaults as Record<string, unknown> | undefined) ?? {}
      const rawInstances = [...((n.instances as Record<string, unknown>[]) ?? [])]
      const sub     = rawInstances[ownerPath[0]] as Record<string, unknown>
      const subDate = String(sub?.date || '')

      // series2 built from editor values, respecting root defaults.
      const series2 = buildSeriesNode(entry, body, occDate, origRepeat, rootDefs, true)

      let newInstances: Record<string, unknown>[]
      if (occDate <= subDate) {
        // Editing at or before the series start → replace the whole series.
        newInstances = [...rawInstances]
        newInstances[ownerPath[0]] = series2
      } else {
        // Mid-series → cap the existing series and insert the new one after it.
        const [series1raw] = splitNode(sub as RawNode, occDate)
        // series1 keeps only structural fields — its occurrence properties are
        // inherited from the root defaults, no need to repeat them.
        const series1 = canonicaliseSeriesNode(series1raw as Record<string, unknown>, rootDefs)
        newInstances = [...rawInstances]
        newInstances.splice(ownerPath[0], 1, series1, series2)
      }

      // Preserve everything at root level; only replace the instances array.
      return { ...n, instances: newInstances } as unknown as RawNode
    }

  // ── add a new occurrence ─────────────────────────────────────────────────
  } else if (editScope === 'add') {
    const instances = [...((n.instances as RawNode[]) ?? [])]
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
 * True when the save result should be auto-collapsed (shared fields hoisted to
 * root defaults).  Only the root-split case benefits from collapse; child-split
 * already has the correct two-level defaults structure.
 */
function shouldCollapse(entry: EntryState): boolean {
  if (entry.editScope !== 'future') return true   // all/single/add → always collapse
  const ownerPath = ((entry.item as any)?.ownerPath as number[] | undefined) ?? []
  return ownerPath.length === 0   // root split → collapse; child split → preserve
}

// ── Misc helpers ──────────────────────────────────────────────────────────────

function extractFrontmatter(content: string): { fm: string; body: string } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (m) return { fm: m[1], body: m[2].trim() }
  return { fm: content, body: '' }
}

function defaultEndDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

// ── Tree display helpers ──────────────────────────────────────────────────────

// Note: getSubNode, setSubNode, splitNode, doEditFollowing are imported from
// '../model/nodeOps' — see imports above.

interface CardItem {
  label:         string
  depth:         number
  fields:        Record<string, unknown>
  instanceCount: number
}

function flattenForDisplay(node: EffectiveNode, depth = 0, pathParts: string[] = []): CardItem[] {
  const label = pathParts.length === 0 ? 'root' : pathParts.join(' › ')
  const items: CardItem[] = [{ label, depth, fields: node.fields, instanceCount: node.instances.length }]
  node.instances.forEach((child, i) =>
    items.push(...flattenForDisplay(child, depth + 1, [...pathParts, `instances[${i}]`])),
  )
  return items
}

const DEPTH_COLOURS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']
const depthColour   = (d: number) => DEPTH_COLOURS[d % DEPTH_COLOURS.length]

// ── Action types ──────────────────────────────────────────────────────────────

type ActionKind =
  | 'add' | 'edit-occurrence' | 'edit-pattern' | 'edit-following'
  | 'delete-occurrence' | 'delete-following' | 'delete-all'

// ── Raw-node action functions ─────────────────────────────────────────────────

function doAddOccurrence(node: RawNode, ownerPath: number[], date: string, time: string, done: boolean): RawNode {
  const sub  = getSubNode(node, ownerPath)
  const inst: Record<string, unknown> = { date }
  if (time) inst.time = time
  inst.done = done
  return setSubNode(node, ownerPath, {
    ...sub,
    instances: [...((sub.instances as RawNode[]) ?? []), inst as RawNode],
  })
}

function doEditOccurrence(
  node: RawNode, ownerPath: number[], occDate: string, date: string, time: string, done: boolean,
): RawNode {
  const sub       = getSubNode(node, ownerPath)
  const instances = [...((sub.instances as RawNode[]) ?? [])]
  const idx       = instances.findIndex(i => String((i as Record<string, unknown>).date) === occDate)
  const updated: Record<string, unknown> = { date }
  if (time) updated.time = time
  updated.done = done
  if (idx >= 0) {
    instances[idx] = { ...instances[idx], ...updated } as RawNode
  } else {
    instances.push(updated as RawNode)
  }
  return setSubNode(node, ownerPath, { ...sub, instances })
}

function doEditPattern(node: RawNode, ownerPath: number[], newRepeat: Record<string, unknown>): RawNode {
  const sub = getSubNode(node, ownerPath)
  return setSubNode(node, ownerPath, { ...sub, repeat: newRepeat })
}

function doDeleteOccurrence(node: RawNode, ownerPath: number[], occ: OccurrenceEntry): RawNode {
  const sub = getSubNode(node, ownerPath)
  if (occ.source === 'generated') {
    // Mark as excluded (preserves any other overrides on this date)
    const instances = [...((sub.instances as RawNode[]) ?? [])]
    const idx = instances.findIndex(i => String((i as Record<string, unknown>).date) === occ.date)
    const excl: Record<string, unknown> = { date: occ.date, excluded: true }
    if (idx >= 0) {
      instances[idx] = { ...instances[idx], ...excl } as RawNode
    } else {
      instances.push(excl as RawNode)
    }
    return setSubNode(node, ownerPath, { ...sub, instances })
  } else {
    // Remove the explicit instance entry entirely
    const instances = ((sub.instances as RawNode[]) ?? []).filter(
      i => String((i as Record<string, unknown>).date) !== occ.date,
    )
    const updated = { ...sub, instances } as RawNode
    if (instances.length === 0) delete (updated as Record<string, unknown>).instances
    return setSubNode(node, ownerPath, updated)
  }
}

function doDeleteFollowing(node: RawNode, ownerPath: number[], occDate: string): RawNode {
  const sub           = getSubNode(node, ownerPath)
  const originalRepeat = ((sub.repeat ?? {}) as Record<string, unknown>)
  const newRepeat     = { ...originalRepeat, end: { type: 'until', date: dayBefore(occDate) } }
  const instances     = ((sub.instances as RawNode[]) ?? []).filter(
    i => String((i as Record<string, unknown>).date) < occDate,
  )
  const updated: Record<string, unknown> = { ...sub, repeat: newRepeat }
  if (instances.length > 0) updated.instances = instances
  else delete updated.instances
  return setSubNode(node, ownerPath, updated as RawNode)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NodeCard({ item, isLast }: { item: CardItem; isLast: boolean }) {
  const { label, depth, fields, instanceCount } = item
  const entries = Object.entries(fields)
  const indent  = depth * 20

  return (
    <div className="flex items-start" style={{ paddingLeft: `${indent}px` }}>
      {depth > 0 && (
        <div className="flex flex-col items-center mr-2 shrink-0" style={{ width: 16 }}>
          <div className={`w-px bg-white/10 ${isLast ? 'h-4' : 'flex-1'}`} style={{ minHeight: 16 }} />
          <div className="w-2 h-px bg-white/10" />
        </div>
      )}
      <div className="flex-1 rounded-lg border border-white/10 bg-white/5 overflow-hidden mb-2">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5">
          <span className={`w-1.5 h-4 rounded-full shrink-0 ${depthColour(depth)}`} />
          <FileText size={13} className="text-white/40 shrink-0" />
          <span className="font-mono text-xs text-white/90 font-medium">{label}</span>
          {depth === 0 && <span className="text-[10px] text-white/20 font-mono ml-1">root</span>}
          <span className="ml-auto text-[10px] text-white/25 font-mono">depth {depth}</span>
          {instanceCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
              {instanceCount} {instanceCount === 1 ? 'child' : 'children'}
            </span>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="px-3 py-2 text-xs text-white/30 italic">no fields</div>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 px-3 py-1.5 text-xs font-mono">
                <span className="text-sky-300 shrink-0 w-28 truncate" title={key}>{key}</span>
                <span className="text-white/80 flex-1 whitespace-pre-wrap break-all" title={JSON.stringify(value)}>
                  {displayValue(value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function OccurrenceRow({
  occ, isSelected, onClick,
}: {
  occ: OccurrenceEntry
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 border-b border-white/5 text-xs font-mono cursor-pointer select-none transition-colors ${
        isSelected
          ? 'bg-blue-500/10 border-l-2 border-l-blue-500/60'
          : 'hover:bg-white/[0.03]'
      } ${occ.done ? 'opacity-40' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${occ.source === 'generated' ? 'bg-white/30' : 'bg-amber-400/60'}`}
        title={occ.source === 'generated' ? 'generated by schedule' : 'explicit instance'} />
      <span className={`shrink-0 ${occ.done ? 'line-through' : ''} text-white/80`}>{occ.date}</span>
      {occ.time
        ? <span className="text-white/40 shrink-0">{occ.time}</span>
        : <span className="text-white/15 shrink-0">—</span>}
      <span className={`ml-auto text-[10px] font-sans px-1.5 py-0.5 rounded ${
        occ.source === 'generated' ? 'bg-white/5 text-white/25' : 'bg-amber-500/10 text-amber-400/70'
      }`}>
        {occ.source === 'generated' ? 'sched' : 'explicit'}
      </span>
      {occ.done && (
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-sans">done</span>
      )}
    </div>
  )
}

// ── Action button ─────────────────────────────────────────────────────────────

function ActionBtn({
  label, icon, active = false, disabled = false, title, onClick,
}: {
  label: string; icon: React.ReactNode; active?: boolean
  disabled?: boolean; title?: string; onClick: () => void
}) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] transition-colors ${
        disabled
          ? 'text-white/15 cursor-not-allowed'
          : active
          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
          : 'text-white/40 hover:text-white/70 hover:bg-white/5 border border-transparent'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

// ── Action forms ──────────────────────────────────────────────────────────────

const inputCls = 'bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] font-mono text-white/70 focus:outline-none focus:border-white/30'
const btnApply = 'px-3 py-1 text-xs rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors disabled:opacity-40'
const btnCancel= 'px-3 py-1 text-xs rounded bg-white/5 text-white/40 hover:bg-white/10 transition-colors'

function AddOccurrenceForm({ onApply, onCancel }: {
  onApply: (date: string, time: string, done: boolean) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [done, setDone] = useState(false)
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-[11px] text-white/30 w-8">date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        <label className="text-[11px] text-white/30">time</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} className={`${inputCls} w-28`} />
        <label className="text-[11px] text-white/30">done</label>
        <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} className="accent-emerald-500" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => date && onApply(date, time, done)} disabled={!date} className={btnApply}>Add</button>
        <button onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

function EditOccurrenceForm({ occ, onApply, onCancel }: {
  occ: OccurrenceEntry
  onApply: (date: string, time: string, done: boolean) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(occ.date)
  const [time, setTime] = useState(occ.time ?? '')
  const [done, setDone] = useState(occ.done ?? false)
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-[11px] text-white/30 w-8">date</label>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
        <label className="text-[11px] text-white/30">time</label>
        <input type="time" value={time} onChange={e => setTime(e.target.value)} className={`${inputCls} w-28`} />
        <label className="text-[11px] text-white/30">done</label>
        <input type="checkbox" checked={done} onChange={e => setDone(e.target.checked)} className="accent-emerald-500" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => onApply(date, time, done)} className={btnApply}>Apply</button>
        <button onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

const DAYS       = ['mo','tu','we','th','fr','sa','su']
const DAY_LABELS = ['Mo','Tu','We','Th','Fr','Sa','Su']

function EditPatternForm({ initialRepeat, onApply, onCancel }: {
  initialRepeat: Record<string, unknown>
  onApply: (repeat: Record<string, unknown>) => void
  onCancel: () => void
}) {
  const endRaw = ((initialRepeat.end ?? {}) as Record<string, unknown>)
  const [repeatType, setRepeatType] = useState(String(initialRepeat.type ?? 'schedule'))
  const [freq,       setFreq]       = useState(String(initialRepeat.freq ?? initialRepeat.scheduled
    ? String((initialRepeat.scheduled as Record<string,unknown>)?.freq ?? 'weekly') : 'weekly'))
  const [interval,   setInterval]   = useState(String(initialRepeat.interval ?? 1))
  const [byweekday,  setByweekday]  = useState<string[]>(
    Array.isArray(initialRepeat.byweekday) ? (initialRepeat.byweekday as string[]) : [],
  )
  const [endType,  setEndType]  = useState<'none'|'until'|'count'>(
    endRaw.type === 'count' ? 'count' : endRaw.type === 'until' ? 'until' : 'none',
  )
  const [endDate,  setEndDate]  = useState(String(endRaw.date ?? ''))
  const [endCount, setEndCount] = useState(String(endRaw.occurrences ?? '1'))

  function handleApply() {
    const repeat: Record<string, unknown> = { type: repeatType }
    if (repeatType === 'schedule') {
      repeat.freq = freq
      const iv = parseInt(interval)
      if (iv > 1) repeat.interval = iv
      if (freq === 'weekly' && byweekday.length > 0) repeat.byweekday = byweekday
    } else {
      // after_completion — interval is a duration-like value
      repeat.interval = parseInt(interval)
    }
    if (endType === 'until' && endDate)  repeat.end = { type: 'until', date: endDate }
    if (endType === 'count' && endCount) repeat.end = { type: 'count', occurrences: parseInt(endCount) }
    onApply(repeat)
  }

  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-[11px] text-white/30 w-8">type</label>
        <select value={repeatType} onChange={e => setRepeatType(e.target.value)} className={inputCls}>
          <option value="schedule">schedule</option>
          <option value="after_completion">after_completion</option>
        </select>
      </div>

      {repeatType === 'schedule' && (
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-[11px] text-white/30 w-8">freq</label>
          <select value={freq} onChange={e => setFreq(e.target.value)} className={inputCls}>
            {['daily','weekly','monthly','yearly'].map(f => <option key={f} value={f}>{f}</option>)}
          </select>
          <label className="text-[11px] text-white/30">every</label>
          <input type="number" min="1" value={interval} onChange={e => setInterval(e.target.value)}
            className={`${inputCls} w-14`} />
        </div>
      )}

      {repeatType === 'after_completion' && (
        <div className="flex flex-wrap gap-2 items-center">
          <label className="text-[11px] text-white/30 w-8">days</label>
          <input type="number" min="1" value={interval} onChange={e => setInterval(e.target.value)}
            className={`${inputCls} w-20`} />
          <span className="text-[11px] text-white/30">after completion</span>
        </div>
      )}

      {repeatType === 'schedule' && freq === 'weekly' && (
        <div className="flex gap-2 items-center flex-wrap">
          <label className="text-[11px] text-white/30 w-8">days</label>
          <div className="flex gap-1">
            {DAYS.map((d, i) => (
              <button key={d}
                onClick={() => setByweekday(p => p.includes(d) ? p.filter(x => x !== d) : [...p, d])}
                className={`text-[11px] px-1.5 py-0.5 rounded font-mono transition-colors ${
                  byweekday.includes(d)
                    ? 'bg-blue-500/30 text-blue-300 border border-blue-500/40'
                    : 'bg-white/5 text-white/40 border border-white/10'
                }`}
              >
                {DAY_LABELS[i]}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-[11px] text-white/30 w-8">end</label>
        {(['none','until','count'] as const).map(t => (
          <button key={t} onClick={() => setEndType(t)}
            className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
              endType === t ? 'bg-white/15 text-white/80' : 'text-white/30 hover:text-white/60'
            }`}
          >{t}</button>
        ))}
        {endType === 'until' && (
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className={inputCls} />
        )}
        {endType === 'count' && (
          <input type="number" min="1" value={endCount} onChange={e => setEndCount(e.target.value)}
            className={`${inputCls} w-20`} />
        )}
      </div>

      <div className="flex gap-2">
        <button onClick={handleApply} className={btnApply}>Apply</button>
        <button onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

function EditFollowingForm({ occ, onApply, onCancel }: {
  occ: OccurrenceEntry
  onApply: () => void
  onCancel: () => void
}) {
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <p className="text-[11px] text-white/50 leading-relaxed">
        The current series ends on <span className="font-mono text-white/70">{dayBefore(occ.date)}</span>.
        A new series starts at <span className="font-mono text-white/70">{occ.date}</span> with the same
        pattern — use <span className="text-white/60">Edit pattern</span> afterwards to change it.
      </p>
      <div className="flex gap-2">
        <button onClick={onApply}
          className="px-3 py-1 text-xs rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 transition-colors">
          Split series
        </button>
        <button onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

function DeleteConfirmForm({ message, label, onApply, onCancel }: {
  message: string; label: string; onApply: () => void; onCancel: () => void
}) {
  return (
    <div className="p-3 space-y-2 border-t border-white/5">
      <p className="text-[11px] text-white/50 leading-relaxed">{message}</p>
      <div className="flex gap-2">
        <button onClick={onApply}
          className="px-3 py-1 text-xs rounded bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors">
          {label}
        </button>
        <button onClick={onCancel} className={btnCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NodeInheritanceDebugger() {
  const [displayContent,  setDisplayContent]  = useState<string>('')
  const [fileName,        setFileName]        = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [isCollapsed,     setIsCollapsed]     = useState(false)
  const [zodErrors,       setZodErrors]       = useState<string[]>([])
  const [results,         setResults]         = useState<EffectiveNode | null>(null)
  const [rawNode,         setRawNode]         = useState<RawNode | null>(null)
  const [expandEndDate,   setExpandEndDate]   = useState<string>(defaultEndDate)
  const [selectedIdx,     setSelectedIdx]     = useState<number | null>(null)
  const [activeAction,    setActiveAction]    = useState<ActionKind | null>(null)

  // ── 4th-column EntryEditor state ─────────────────────────────────────────
  const [debugEntry,       setDebugEntry]      = useState<EntryState | null>(null)
  const [debugDialog,      setDebugDialog]     = useState<string | null>(null)

  // ── Parse ────────────────────────────────────────────────────────────────
  const processContent = useCallback((content: string, name: string) => {
    setDisplayContent(content)
    setFileName(name)
    setZodErrors([])
    setResults(null)
    setRawNode(null)
    setIsCollapsed(false)
    setSelectedIdx(null)
    setActiveAction(null)

    const { fm } = extractFrontmatter(content)
    let parsed: unknown
    try { parsed = yamlParse(fm) }
    catch (e) { setZodErrors([`YAML parse error: ${String(e)}`]); return }

    const v = RawNodeSchema.safeParse(parsed)
    if (!v.success) { setZodErrors(v.error.issues.map(e => `${e.path.join('.')}: ${e.message}`)); return }

    const rn = v.data as RawNode
    setRawNode(rn)
    setResults(buildEffectiveTree(rn))
    setDebugEntry(null)
  }, [])

  // ── Apply a raw-node mutation ────────────────────────────────────────────
  const applyRawNode = useCallback((newNode: RawNode) => {
    const { body } = extractFrontmatter(displayContent)
    processContent(serializeRawNode(newNode, body), fileName)
  }, [displayContent, fileName, processContent])

  // ── Collapse ─────────────────────────────────────────────────────────────
  const handleCollapse = useCallback(() => {
    if (!results) return
    const { body } = extractFrontmatter(originalContent || displayContent)
    const collapsed = collapseToYaml(results, body)
    setDisplayContent(collapsed)
    setIsCollapsed(true)
    setSelectedIdx(null)
    setActiveAction(null)
    const { fm } = extractFrontmatter(collapsed)
    try {
      const v = RawNodeSchema.safeParse(yamlParse(fm))
      if (v.success) { const rn = v.data as RawNode; setRawNode(rn); setResults(buildEffectiveTree(rn)); setZodErrors([]) }
    } catch { /* keep existing results */ }
  }, [results, originalContent, displayContent])

  const handleReset = useCallback(() => {
    if (originalContent) processContent(originalContent, fileName)
  }, [originalContent, fileName, processContent])

  // ── Delete all ───────────────────────────────────────────────────────────
  const handleDeleteAll = useCallback(() => {
    setDisplayContent('')
    setFileName('')
    setOriginalContent('')
    setResults(null)
    setRawNode(null)
    setZodErrors([])
    setIsCollapsed(false)
    setSelectedIdx(null)
    setActiveAction(null)
    setDebugEntry(null)
  }, [])

  // ── File input ────────────────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const text = await file.text(); setOriginalContent(text); processContent(text, file.name); e.target.value = ''
  }, [processContent])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]; if (!file) return
    const text = await file.text(); setOriginalContent(text); processContent(text, file.name)
  }, [processContent])

  // ── Derived state ─────────────────────────────────────────────────────────
  const displayItems = useMemo(() => results ? flattenForDisplay(results) : [], [results])
  const canCollapse  = results !== null
  const isEmpty      = !displayContent

  const nodeHasRepeat      = results ? treeHasOccurrences(results) : false
  const occurrences        = useMemo<OccurrenceEntry[] | null>(() => {
    if (!results || !nodeHasRepeat) return null
    return collectAllOccurrences(results, expandEndDate)
  }, [results, nodeHasRepeat, expandEndDate])

  // ── Selection / 4th-column open ───────────────────────────────────────────
  const handleSelectOccurrence = useCallback((idx: number) => {
    if (selectedIdx === idx) {
      setSelectedIdx(null)
      setActiveAction(null)
      setDebugEntry(null)
    } else {
      setSelectedIdx(idx)
      setActiveAction(null)
      if (rawNode) {
        const occEntry = (occurrences ?? [])[idx]
        if (occEntry) setDebugEntry(entryFromOccurrence(toOccurrence(occEntry, rawNode)))
      }
    }
  }, [selectedIdx, rawNode, occurrences])

  // ── EntryEditor handlers (4th column) ─────────────────────────────────────
  const handleDebugSave = useCallback((body: string) => {
    if (!debugEntry || !rawNode) return
    const updated = applyDebugSave(rawNode, debugEntry, body)

    // For root-level splits and non-future edits: collapse to canonical form so
    // shared fields are hoisted to root defaults:.
    // For child-series splits: the two-level defaults structure was already built
    // correctly by applyDebugSave; collapse would destroy nested defaults: blocks.
    if (shouldCollapse(debugEntry)) {
      const { body: origBody } = extractFrontmatter(displayContent)
      const effectiveTree = buildEffectiveTree(updated)
      const collapsed = collapseToYaml(effectiveTree, origBody)
      const { fm } = extractFrontmatter(collapsed)
      try {
        const v = RawNodeSchema.safeParse(yamlParse(fm))
        if (v.success) {
          const rn = v.data as RawNode
          setDisplayContent(collapsed)
          setRawNode(rn)
          setResults(buildEffectiveTree(rn))
          setZodErrors([])
          setIsCollapsed(true)
          setSelectedIdx(null)
          setDebugEntry(null)
          return
        }
      } catch { /* fall through */ }
    }

    applyRawNode(updated)
    setSelectedIdx(null)
    setDebugEntry(null)
  }, [debugEntry, rawNode, applyRawNode, displayContent])

  const handleDebugClose = useCallback(() => {
    setSelectedIdx(null)
    setDebugEntry(null)
  }, [])

  const handleDebugScopeChange = useCallback((scope: string) => {
    setDebugEntry(prev => {
      if (!prev?.item) return prev
      const occ = prev.item as Occurrence
      const { scheduled } = applyScope(occ, scope)
      // applyScope reads root.repeat, which is null for collapsed containers
      // (repeat lives on sub-instances there).  Use the occurrence's own repeat instead.
      const repeat =
        scope === 'future' || scope === 'all'
          ? (occ.repeat ?? null)
          : null
      return { ...prev, editScope: scope, scheduled, repeat }
    })
  }, [])

  const selectedOcc = selectedIdx !== null ? (occurrences ?? [])[selectedIdx] ?? null : null

  const handleDebugDelete = useCallback(() => {
    if (!rawNode || !selectedOcc) return
    const updated = doDeleteOccurrence(rawNode, selectedOcc.ownerPath, selectedOcc)
    applyRawNode(updated)
    setSelectedIdx(null)
    setDebugEntry(null)
  }, [rawNode, selectedOcc, applyRawNode])

  // Repeat object on the owning sub-node (used by Edit pattern form)
  const selectedOwnerRepeat = useMemo<Record<string, unknown> | null>(() => {
    if (!selectedOcc || !rawNode) return null
    const sub = getSubNode(rawNode, selectedOcc.ownerPath)
    return sub?.repeat ? (sub.repeat as Record<string, unknown>) : null
  }, [selectedOcc, rawNode])

  const canEditPattern    = selectedOcc?.source === 'generated'
  const canEditFollowing  = selectedOcc !== null && selectedOwnerRepeat !== null
  // "Delete occurrence" (single) only makes sense when there are multiple occurrences;
  // when there is only one, "Delete all" (labeled "Delete occurrence") covers it.
  const totalOccurrences  = occurrences?.length ?? 0
  const canDeleteSingle   = selectedOcc !== null && totalOccurrences > 1
  const canDeleteFollowing = canEditFollowing  // same gate as edit-following
  // "Delete all" is always available once a file is loaded; label changes when only 1 occ.
  const deleteAllLabel    = totalOccurrences <= 1 ? 'Delete occurrence' : 'Delete all'

  function toggleAction(kind: ActionKind) {
    setActiveAction(a => a === kind ? null : kind)
  }

  return (
    <div
      className="flex flex-col h-screen bg-[#111318] text-white"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ── Top bar ── */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <span className="text-sm font-semibold tracking-wide text-white/70"
          style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic' }}>Meridian</span>
        <ChevronRight size={14} className="text-white/30" />
        <span className="text-sm text-white/50">Inheritance Debugger</span>
        {fileName && (<>
          <ChevronRight size={14} className="text-white/30" />
          <span className="text-sm font-mono text-white/70">{fileName}</span>
          {isCollapsed && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">collapsed</span>}
        </>)}
        <div className="ml-auto flex items-center gap-2">
          {isCollapsed && (
            <button onClick={handleReset} title="Reset to original file"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/60 transition-colors">
              <RotateCcw size={12} /> Original
            </button>
          )}
          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors">
            <Upload size={13} /> Load file
            <input type="file" accept=".md,.yaml,.yml" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT: source */}
        <div className="w-[20%] flex flex-col border-r border-white/10 min-h-0">
          <div className="px-3 py-2 text-[11px] uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0">
            {isCollapsed ? 'Collapsed YAML' : 'Source'}
          </div>
          <div className="flex-1 overflow-auto">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/25 select-none">
                <Upload size={32} strokeWidth={1.2} />
                <span className="text-sm">Drop a .md / .yaml file here</span>
                <span className="text-xs">or use the Load file button</span>
              </div>
            ) : (
              <pre className="p-4 text-xs leading-5 text-white/70 whitespace-pre-wrap break-all"
                style={{ fontFamily: 'DM Mono, monospace' }}>{displayContent}</pre>
            )}
          </div>
        </div>

        {/* Divider with ‹ button */}
        <div className="flex flex-col items-center justify-center w-8 shrink-0 border-r border-white/10 bg-white/[0.02]">
          <button onClick={handleCollapse} disabled={!canCollapse}
            title={canCollapse ? 'Collapse effective nodes → compact YAML' : 'Load a file first'}
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
              canCollapse ? 'text-white/50 hover:text-white hover:bg-white/10 cursor-pointer' : 'text-white/15 cursor-not-allowed'
            }`}>
            <ChevronLeft size={14} />
          </button>
        </div>

        {/* MIDDLE: effective tree */}
        <div className="w-[24%] flex flex-col border-r border-white/10 min-h-0">
          <div className="px-3 py-2 text-[11px] uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0 flex items-center gap-2">
            Effective tree
            {displayItems.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono normal-case tracking-normal">
                {displayItems.length}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4">
            {zodErrors.length > 0 && (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={14} className="text-red-400" />
                  <span className="text-xs font-semibold text-red-300">Parse / validation errors</span>
                </div>
                <ul className="space-y-1">
                  {zodErrors.map((err, i) => <li key={i} className="text-xs font-mono text-red-300/80">{err}</li>)}
                </ul>
              </div>
            )}
            {!displayContent && zodErrors.length === 0 && (
              <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">
                Load a file to see effective nodes
              </div>
            )}
            {displayItems.map((item, i) => {
              const next   = displayItems[i + 1]
              const isLast = !next || next.depth < item.depth
              return <NodeCard key={i} item={item} isLast={isLast} />
            })}
          </div>
        </div>

        {/* 3RD COLUMN: repeat expansion */}
        <div className="w-[22%] flex flex-col min-h-0 border-r border-white/10">
          {/* Header */}
          <div className="px-3 py-2 text-[11px] uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0 flex items-center gap-2">
            <CalendarDays size={12} className="text-white/30" />
            <span>Occurrences</span>
            {occurrences && occurrences.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono normal-case tracking-normal">
                {occurrences.length}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <input type="date" value={expandEndDate} onChange={e => setExpandEndDate(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[11px] font-mono text-white/60 focus:outline-none focus:border-white/25 normal-case tracking-normal" />
            </div>
          </div>

          {/* Occurrence list */}
          <div className="flex-1 overflow-auto">
            {!displayContent && (
              <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">
                Load a file
              </div>
            )}
            {displayContent && !nodeHasRepeat && zodErrors.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20 select-none">
                <CalendarDays size={28} strokeWidth={1.2} />
                <span className="text-sm text-center px-2">No <span className="font-mono">date:</span> or <span className="font-mono">repeat:</span> found</span>
              </div>
            )}
            {occurrences !== null && (
              occurrences.length === 0
                ? <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">
                    No occurrences before {expandEndDate}
                  </div>
                : occurrences.map((occ, i) => (
                    <OccurrenceRow key={i} occ={occ} isSelected={selectedIdx === i}
                      onClick={() => handleSelectOccurrence(i)} />
                  ))
            )}
          </div>

          {/* Raw-manipulation action panel (debug-only operations) */}
          {displayContent && zodErrors.length === 0 && (
            <div className="shrink-0 border-t border-white/10 bg-[#0d1015]">
              {selectedOcc === null ? (
                <div className="px-3 py-2.5 text-[11px] text-white/20 select-none">
                  {occurrences && occurrences.length > 0
                    ? 'Select an occurrence to apply actions'
                    : nodeHasRepeat ? '' : 'Add occurrences below'}
                </div>
              ) : (
                <>
                  {/* Edit actions row */}
                  <div className="flex flex-wrap gap-1 px-3 pt-2 pb-1">
                    <ActionBtn label="Add occurrence"   icon={<Plus size={11} />}
                      active={activeAction === 'add'}
                      onClick={() => toggleAction('add')} />
                    <ActionBtn label="Edit occurrence"  icon={<Pencil size={11} />}
                      active={activeAction === 'edit-occurrence'}
                      onClick={() => toggleAction('edit-occurrence')} />
                    <ActionBtn label="Edit pattern"     icon={<Repeat size={11} />}
                      active={activeAction === 'edit-pattern'}
                      disabled={!canEditPattern}
                      title={!canEditPattern ? 'Only available for schedule-generated occurrences' : undefined}
                      onClick={() => toggleAction('edit-pattern')} />
                    <ActionBtn label="This & following" icon={<ChevronsRight size={11} />}
                      active={activeAction === 'edit-following'}
                      disabled={!canEditFollowing}
                      title={!canEditFollowing ? 'Requires a repeat field' : undefined}
                      onClick={() => toggleAction('edit-following')} />
                  </div>

                  {/* Delete actions row */}
                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                    <ActionBtn label="Delete occurrence" icon={<Trash2 size={11} />}
                      active={activeAction === 'delete-occurrence'}
                      disabled={!canDeleteSingle}
                      title={!canDeleteSingle ? 'Only one occurrence — use Delete all' : undefined}
                      onClick={() => toggleAction('delete-occurrence')} />
                    <ActionBtn label="Delete following"  icon={<Trash2 size={11} />}
                      active={activeAction === 'delete-following'}
                      disabled={!canDeleteFollowing}
                      title={!canDeleteFollowing ? 'Requires a repeat field' : undefined}
                      onClick={() => toggleAction('delete-following')} />
                    <ActionBtn label={deleteAllLabel} icon={<Trash2 size={11} />}
                      active={activeAction === 'delete-all'}
                      onClick={() => toggleAction('delete-all')} />
                  </div>

                  {/* Forms */}
                  {activeAction === 'add' && rawNode && selectedOcc && (
                    <AddOccurrenceForm
                      onApply={(date, time, done) => applyRawNode(doAddOccurrence(rawNode, selectedOcc.ownerPath, date, time, done))}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-occurrence' && rawNode && selectedOcc && (
                    <EditOccurrenceForm occ={selectedOcc}
                      onApply={(date, time, done) => applyRawNode(doEditOccurrence(rawNode, selectedOcc.ownerPath, selectedOcc.date, date, time, done))}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-pattern' && rawNode && selectedOcc && selectedOwnerRepeat && (
                    <EditPatternForm initialRepeat={selectedOwnerRepeat}
                      onApply={repeat => applyRawNode(doEditPattern(rawNode, selectedOcc.ownerPath, repeat))}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-following' && rawNode && selectedOcc && (
                    <EditFollowingForm occ={selectedOcc}
                      onApply={() => applyRawNode(doEditFollowing(rawNode, selectedOcc.ownerPath, selectedOcc.date))}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-occurrence' && rawNode && selectedOcc && (
                    <DeleteConfirmForm
                      message={selectedOcc.source === 'generated'
                        ? `Mark ${selectedOcc.date} as excluded — it will be hidden from the schedule.`
                        : `Remove the explicit instance on ${selectedOcc.date} entirely.`}
                      label="Delete occurrence"
                      onApply={() => applyRawNode(doDeleteOccurrence(rawNode, selectedOcc.ownerPath, selectedOcc))}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-following' && rawNode && selectedOcc && (
                    <DeleteConfirmForm
                      message={`End the series on ${dayBefore(selectedOcc.date)}. Occurrences from ${selectedOcc.date} onwards will be removed.`}
                      label="Delete this & following"
                      onApply={() => applyRawNode(doDeleteFollowing(rawNode, selectedOcc.ownerPath, selectedOcc.date))}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-all' && (
                    <DeleteConfirmForm
                      message="Delete the entire node. This clears all occurrences and cannot be undone (use Original to restore the loaded file)."
                      label={deleteAllLabel}
                      onApply={handleDeleteAll}
                      onCancel={() => setActiveAction(null)} />
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* 4TH COLUMN: EntryEditor */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#0f1318]">
          {debugEntry ? (
            <>
              <EntryEditor
                entry={debugEntry}
                onChange={setDebugEntry as any}
                onSave={handleDebugSave}
                onDelete={handleDebugDelete}
                onClose={handleDebugClose}
                onOpenDlg={setDebugDialog}
                onOpenRepeatDlg={() => setDebugDialog('dlgRepeat')}
                onScopeChange={handleDebugScopeChange}
              />

              {/* Dialogs */}
              <DatePickerDialog
                open={debugDialog === 'dlgSched'}
                initialDate={debugEntry.scheduled?.date || fmtISO(new Date())}
                onConfirm={date => { setDebugEntry(prev => prev ? { ...prev, scheduled: { date, time: prev.scheduled?.time || '' } } : prev); setDebugDialog(null) }}
                onRemove={() => { setDebugEntry(prev => prev ? { ...prev, scheduled: null, duration: '' } : prev); setDebugDialog(null) }}
                onClose={() => setDebugDialog(null)}
              />
              <TimePickerDialog
                open={debugDialog === 'dlgTime'}
                value={debugEntry.scheduled?.time || ''}
                onConfirm={time => { setDebugEntry(prev => prev?.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time } } : prev); setDebugDialog(null) }}
                onRemove={() => { setDebugEntry(prev => prev?.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: '' } } : prev); setDebugDialog(null) }}
                onClose={() => setDebugDialog(null)}
              />
              <DurationDialog
                open={debugDialog === 'dlgDur'}
                value={debugEntry.duration || ''}
                onConfirm={dur => { setDebugEntry(prev => prev ? { ...prev, duration: dur } : prev); setDebugDialog(null) }}
                onRemove={() => { setDebugEntry(prev => prev ? { ...prev, duration: '' } : prev); setDebugDialog(null) }}
                onClose={() => setDebugDialog(null)}
              />
              <PriorityDrawer
                open={debugDialog === 'dlgPriority'}
                value={debugEntry.priority}
                onSelect={p => { setDebugEntry(prev => prev ? { ...prev, priority: p } : prev); setDebugDialog(null) }}
                onClose={() => setDebugDialog(null)}
              />
              <RepeatDialog
                open={debugDialog === 'dlgRepeat'}
                scheduled={debugEntry.scheduled}
                tracked={debugEntry.tracked}
                itemType={debugEntry.itemType}
                repeat={debugEntry.repeat}
                onConfirm={r => { setDebugEntry(prev => prev ? { ...prev, repeat: r } : prev); setDebugDialog(null) }}
                onRemove={() => { setDebugEntry(prev => prev ? { ...prev, repeat: null } : prev); setDebugDialog(null) }}
                onClose={() => setDebugDialog(null)}
              />
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-white/20 select-none">
              <CalendarDays size={32} strokeWidth={1.2} />
              <span className="text-sm">
                {occurrences && occurrences.length > 0
                  ? 'Select an occurrence to edit'
                  : displayContent ? '' : 'Load a file to begin'}
              </span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
