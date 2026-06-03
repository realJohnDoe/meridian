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
import {
  collectAllOccurrences, collectRepeatPatterns, treeHasOccurrences,
  fmtISO,
  type OccurrenceEntry, type RepeatPattern,
} from '../model/expansion'
import {
  dayBefore, getSubNode, setSubNode, doEditFollowing,
} from '../model/nodeOps'
import { yamlParse, splitFrontmatter, wrapFrontmatter } from '../fileIO'
import type { Occurrence, Priority, Repeat as RepeatType } from '../types'
import EntryEditor, { type EntryState } from '../components/EntryEditor'
import RepeatDialog from '../components/RepeatDialog'
import DatePickerDialog from '../components/DatePickerDialog'
import TimePickerDialog from '../components/TimePickerDialog'
import DurationDialog from '../components/DurationDialog'
import PriorityDrawer from '../components/PriorityDrawer'
import { applyScope, entryFromOccurrence } from '../meridian'
import { applyNodeEdit, shouldCollapse } from '../nodeEdit'

// ── Debug metadata type ───────────────────────────────────────────────────────

interface DebugMetadata {
  title:      string
  done?:      boolean
  tags:       string[]
  priority?:  Priority
  body:       string
  duration:   string
  _ownerPath: number[]   // tree navigation path (debug-only)
}

const makeExtractDebugMetadata = (ownerPath: number[]) => (fields: Record<string, unknown>): DebugMetadata => ({
  title:      fields.title    ? String(fields.title)    : '',
  done:       fields.done     as boolean | undefined,
  tags:       Array.isArray(fields.tags) ? (fields.tags as string[]) : [],
  priority:   fields.priority as Priority | undefined,
  body:       fields.body     ? String(fields.body)     : '',
  duration:   fields.duration ? String(fields.duration) : '',
  _ownerPath: ownerPath,
})

// Simple wrapper that collects with ownerPath stored in metadata
function collectAllOccurrencesWithPath(node: EffectiveNode, endDateStr: string): OccurrenceEntry<DebugMetadata>[] {
  const results: OccurrenceEntry<DebugMetadata>[] = []
  const to = new Date(`${endDateStr}T23:59:59`)

  function walk(n: EffectiveNode, path: number[]) {
    const extract = makeExtractDebugMetadata(path)
    if (n.fields.repeat !== undefined && n.fields.repeat !== null) {
      results.push(...collectAllOccurrences(n, endDateStr, extract))
    } else if (n.fields.date !== undefined) {
      const dateStr = String(n.fields.date)
      const d = new Date(`${dateStr}T00:00:00`)
      if (!isNaN(d.getTime()) && d <= to) {
        const metaFields = Object.fromEntries(
          Object.entries(n.fields).filter(([k]) => !['date','time','instances','defaults','excluded','_isGenerated'].includes(k)),
        )
        results.push({
          date:     dateStr,
          time:     n.fields.time ? String(n.fields.time) : null,
          source:   'explicit',
          fileSlug: '',
          id:       crypto.randomUUID(),
          metadata: extract(metaFields),
        })
      }
    } else {
      n.instances.forEach((child, i) => walk(child, [...path, i]))
    }
  }

  walk(node, [])
  return results.sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
}

function collectRepeatPatternsWithPath(node: EffectiveNode): RepeatPattern<DebugMetadata>[] {
  const results: RepeatPattern<DebugMetadata>[] = []

  function walk(n: EffectiveNode, path: number[]) {
    const extract = makeExtractDebugMetadata(path)
    if (n.fields.repeat !== undefined && n.fields.repeat !== null) {
      const metaFields = Object.fromEntries(
        Object.entries(n.fields).filter(([k]) => !['date','time','instances','defaults','excluded','_isGenerated'].includes(k)),
      )
      results.push({
        date:     String(n.fields.date ?? ''),
        time:     n.fields.time ? String(n.fields.time) : null,
        repeat:   n.fields.repeat as RepeatType,
        fileSlug: '',
        id:       crypto.randomUUID(),
        metadata: extract(metaFields),
      })
    }
    n.instances.forEach((child, i) => walk(child, [...path, i]))
  }

  walk(node, [])
  return results
}

type DebugOccurrence = OccurrenceEntry<DebugMetadata>
type DebugPattern    = RepeatPattern<DebugMetadata>

// ── OccurrenceEntry → Occurrence bridge ───────────────────────────────────────

function toOccurrence(
  entry:    DebugOccurrence,
  rawNode:  RawNode,
  pattern?: DebugPattern,
): Occurrence {
  const m = entry.metadata
  const [y, mo, d] = entry.date.split('-').map(Number)
  const jsTime = entry.time
    ? new Date(y, mo - 1, d, +entry.time.slice(0, 2), +entry.time.slice(3, 5))
    : new Date(y, mo - 1, d)
  const slug = String((rawNode as Record<string, unknown>).id ?? 'debug-node')
  // Use a synthetic ownerId so isRecur is true for recurring occurrences.
  // The actual repeat type is passed via the seriesRepeat prop to EntryEditor.
  const syntheticOwnerId = pattern ? `debug:${JSON.stringify(pattern.metadata._ownerPath)}` : entry.ownerId
  return {
    date:     entry.date,
    time:     entry.time ?? null,
    source:   entry.source,
    fileSlug: entry.fileSlug || slug,
    id:       entry.id,
    ownerId:  syntheticOwnerId,
    metadata: {
      title:    m.title,
      done:     m.done,
      tags:     m.tags,
      priority: m.priority,
      body:     m.body,
      duration: m.duration,
      jsTime,
    },
  } as Occurrence
}


// applyNodeEdit and shouldCollapse are imported from '../nodeEdit'

// ── Misc helpers ──────────────────────────────────────────────────────────────

function defaultEndDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

// ── Tree display helpers ──────────────────────────────────────────────────────

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

function doEditPattern(node: RawNode, ownerPath: number[], newRepeat: RepeatType): RawNode {
  const sub = getSubNode(node, ownerPath)
  return setSubNode(node, ownerPath, { ...sub, repeat: newRepeat })
}

function doDeleteOccurrence(node: RawNode, ownerPath: number[], occ: DebugOccurrence): RawNode {
  const sub = getSubNode(node, ownerPath)
  if (occ.source === 'generated') {
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
  occ: DebugOccurrence
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
      } ${occ.metadata.done ? 'opacity-40' : ''}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${occ.source === 'generated' ? 'bg-white/30' : 'bg-amber-400/60'}`}
        title={occ.source === 'generated' ? 'generated by schedule' : 'explicit instance'}
      />
      <span className={`shrink-0 ${occ.metadata.done ? 'line-through' : ''} text-white/80`}>{occ.date}</span>
      {occ.time
        ? <span className="text-white/40 shrink-0">{occ.time}</span>
        : <span className="text-white/15 shrink-0">—</span>}
      <span className={`ml-auto text-[10px] font-sans px-1.5 py-0.5 rounded ${
        occ.source === 'generated' ? 'bg-white/5 text-white/25' : 'bg-amber-500/10 text-amber-400/70'
      }`}>
        {occ.source === 'generated' ? 'sched' : 'explicit'}
      </span>
      {occ.metadata.done && (
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
const btnCancel = 'px-3 py-1 text-xs rounded bg-white/5 text-white/40 hover:bg-white/10 transition-colors'

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
  occ: DebugOccurrence
  onApply: (date: string, time: string, done: boolean) => void
  onCancel: () => void
}) {
  const [date, setDate] = useState(occ.date)
  const [time, setTime] = useState(occ.time ?? '')
  const [done, setDone] = useState(occ.metadata.done ?? false)
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

function EditFollowingForm({ occ, onApply, onCancel }: {
  occ: DebugOccurrence
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
  const [debugEntry,        setDebugEntry]        = useState<EntryState | null>(null)
  const [debugDialog,       setDebugDialog]       = useState<string | null>(null)
  const [patternDialogOpen, setPatternDialogOpen] = useState(false)

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

    const { fm } = splitFrontmatter(content)
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

  const applyRawNode = useCallback((newNode: RawNode) => {
    const { body } = splitFrontmatter(displayContent)
    processContent(wrapFrontmatter(serializeRawNode(newNode), body), fileName)
  }, [displayContent, fileName, processContent])

  const handleCollapse = useCallback(() => {
    if (!results) return
    const { body } = splitFrontmatter(originalContent || displayContent)
    const collapsed = wrapFrontmatter(collapseToYaml(results), body)
    setDisplayContent(collapsed)
    setIsCollapsed(true)
    setSelectedIdx(null)
    setActiveAction(null)
    const { fm } = splitFrontmatter(collapsed)
    try {
      const v = RawNodeSchema.safeParse(yamlParse(fm))
      if (v.success) { const rn = v.data as RawNode; setRawNode(rn); setResults(buildEffectiveTree(rn)); setZodErrors([]) }
    } catch { /* keep existing results */ }
  }, [results, originalContent, displayContent])

  const handleReset = useCallback(() => {
    if (originalContent) processContent(originalContent, fileName)
  }, [originalContent, fileName, processContent])

  const handleDeleteAll = useCallback(() => {
    setDisplayContent(''); setFileName(''); setOriginalContent('')
    setResults(null); setRawNode(null); setZodErrors([])
    setIsCollapsed(false); setSelectedIdx(null); setActiveAction(null); setDebugEntry(null)
  }, [])

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
  const displayItems  = useMemo(() => results ? flattenForDisplay(results) : [], [results])
  const canCollapse   = results !== null
  const isEmpty       = !displayContent
  const nodeHasRepeat = results ? treeHasOccurrences(results) : false

  const occurrences = useMemo<DebugOccurrence[] | null>(() => {
    if (!results || !nodeHasRepeat) return null
    return collectAllOccurrencesWithPath(results, expandEndDate)
  }, [results, nodeHasRepeat, expandEndDate])

  const patterns = useMemo<DebugPattern[]>(
    () => results ? collectRepeatPatternsWithPath(results) : [],
    [results],
  )

  const findPattern = useCallback((ownerPath: number[]): DebugPattern | undefined => {
    const key = JSON.stringify(ownerPath)
    return patterns.find(p => JSON.stringify(p.metadata._ownerPath) === key)
  }, [patterns])

  // ── Selection ────────────────────────────────────────────────────────────
  const handleSelectOccurrence = useCallback((idx: number) => {
    if (selectedIdx === idx) {
      setSelectedIdx(null); setActiveAction(null); setDebugEntry(null)
    } else {
      setSelectedIdx(idx); setActiveAction(null)
      if (rawNode) {
        const occEntry = (occurrences ?? [])[idx]
        if (occEntry) {
          const pattern = findPattern(occEntry.metadata._ownerPath)
          setDebugEntry(entryFromOccurrence(toOccurrence(occEntry, rawNode, pattern), 'single'))
        }
      }
    }
  }, [selectedIdx, rawNode, occurrences, findPattern])

  // ── EntryEditor handlers ─────────────────────────────────────────────────
  const handleDebugSave = useCallback((body: string) => {
    if (!debugEntry || !rawNode) return
    const selectedOccPath = (debugEntry.item as Occurrence | null)?.metadata?._ownerPath as number[] | undefined
    const updated = applyNodeEdit(rawNode, debugEntry, body, selectedOccPath)

    if (shouldCollapse(debugEntry, selectedOccPath)) {
      const { body: origBody } = splitFrontmatter(displayContent)
      const effectiveTree = buildEffectiveTree(updated)
      const collapsed = wrapFrontmatter(collapseToYaml(effectiveTree), origBody)
      const { fm } = splitFrontmatter(collapsed)
      try {
        const v = RawNodeSchema.safeParse(yamlParse(fm))
        if (v.success) {
          const rn = v.data as RawNode
          setDisplayContent(collapsed); setRawNode(rn); setResults(buildEffectiveTree(rn))
          setZodErrors([]); setIsCollapsed(true); setSelectedIdx(null); setDebugEntry(null)
          return
        }
      } catch { /* fall through */ }
    }

    applyRawNode(updated)
    setSelectedIdx(null); setDebugEntry(null)
  }, [debugEntry, rawNode, applyRawNode, displayContent])

  const handleDebugClose = useCallback(() => {
    setSelectedIdx(null); setDebugEntry(null)
  }, [])

  const handleDebugScopeChange = useCallback((scope: string) => {
    setDebugEntry(prev => {
      if (!prev?.item) return prev
      const occ = prev.item as Occurrence
      const { scheduled } = applyScope(occ, scope)

      if (scope === 'future' || scope === 'all') {
        const occPath = (occ.metadata as DebugMetadata)._ownerPath ?? []
        const pattern = findPattern(occPath)
        const repeat = pattern?.repeat ?? null
        const pm = pattern?.metadata
        return {
          ...prev, editScope: scope, scheduled, repeat,
          title:    pm?.title    ?? prev.title,
          tags:     pm?.tags     ? [...pm.tags] : prev.tags,
          priority: pm?.priority ?? prev.priority ?? null,
          bodyHtml: pm?.body     ?? prev.bodyHtml,
          duration: pm?.duration ?? prev.duration,
          tracked:  prev.tracked,
          done:     pm?.done ?? prev.done,
        }
      }
      return { ...prev, editScope: scope, scheduled, repeat: null }
    })
  }, [findPattern])

  const selectedOcc = selectedIdx !== null ? (occurrences ?? [])[selectedIdx] ?? null : null

  const handleDebugDelete = useCallback(() => {
    if (!rawNode || !selectedOcc) return
    applyRawNode(doDeleteOccurrence(rawNode, selectedOcc.metadata._ownerPath, selectedOcc))
    setSelectedIdx(null); setDebugEntry(null)
  }, [rawNode, selectedOcc, applyRawNode])

  const selectedPattern = useMemo<DebugPattern | null>(
    () => selectedOcc ? findPattern(selectedOcc.metadata._ownerPath) ?? null : null,
    [selectedOcc, findPattern],
  )

  const canEditPattern     = selectedOcc?.source === 'generated'
  const canEditFollowing   = selectedOcc !== null && selectedPattern !== null
  const totalOccurrences   = occurrences?.length ?? 0
  const canDeleteSingle    = selectedOcc !== null && totalOccurrences > 1
  const canDeleteFollowing = canEditFollowing
  const deleteAllLabel     = totalOccurrences <= 1 ? 'Delete occurrence' : 'Delete all'

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

        {/* 3RD COLUMN: occurrences */}
        <div className="w-[22%] flex flex-col min-h-0 border-r border-white/10">
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

          <div className="flex-1 overflow-auto">
            {!displayContent && (
              <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">Load a file</div>
            )}
            {displayContent && !nodeHasRepeat && zodErrors.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20 select-none">
                <CalendarDays size={28} strokeWidth={1.2} />
                <span className="text-sm text-center px-2">No <span className="font-mono">date:</span> or <span className="font-mono">repeat:</span> found</span>
              </div>
            )}
            {occurrences !== null && (
              occurrences.length === 0
                ? <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">No occurrences before {expandEndDate}</div>
                : occurrences.map((occ, i) => (
                    <OccurrenceRow key={i} occ={occ} isSelected={selectedIdx === i} onClick={() => handleSelectOccurrence(i)} />
                  ))
            )}
          </div>

          {displayContent && zodErrors.length === 0 && (
            <div className="shrink-0 border-t border-white/10 bg-[#0d1015]">
              {selectedOcc === null ? (
                <div className="px-3 py-2.5 text-[11px] text-white/20 select-none">
                  {occurrences && occurrences.length > 0 ? 'Select an occurrence to apply actions' : nodeHasRepeat ? '' : 'Add occurrences below'}
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1 px-3 pt-2 pb-1">
                    <ActionBtn label="Add occurrence"   icon={<Plus size={11} />}       active={activeAction === 'add'}            onClick={() => toggleAction('add')} />
                    <ActionBtn label="Edit occurrence"  icon={<Pencil size={11} />}     active={activeAction === 'edit-occurrence'} onClick={() => toggleAction('edit-occurrence')} />
                    <ActionBtn label="Edit pattern"     icon={<Repeat size={11} />}     active={activeAction === 'edit-pattern'}
                      disabled={!canEditPattern} title={!canEditPattern ? 'Only available for schedule-generated occurrences' : undefined}
                      onClick={() => { toggleAction('edit-pattern'); setPatternDialogOpen(true) }} />
                    <ActionBtn label="This & following" icon={<ChevronsRight size={11} />} active={activeAction === 'edit-following'}
                      disabled={!canEditFollowing} title={!canEditFollowing ? 'Requires a repeat field' : undefined}
                      onClick={() => toggleAction('edit-following')} />
                  </div>
                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                    <ActionBtn label="Delete occurrence" icon={<Trash2 size={11} />} active={activeAction === 'delete-occurrence'}
                      disabled={!canDeleteSingle} title={!canDeleteSingle ? 'Only one occurrence — use Delete all' : undefined}
                      onClick={() => toggleAction('delete-occurrence')} />
                    <ActionBtn label="Delete following"  icon={<Trash2 size={11} />} active={activeAction === 'delete-following'}
                      disabled={!canDeleteFollowing} title={!canDeleteFollowing ? 'Requires a repeat field' : undefined}
                      onClick={() => toggleAction('delete-following')} />
                    <ActionBtn label={deleteAllLabel}    icon={<Trash2 size={11} />} active={activeAction === 'delete-all'} onClick={() => toggleAction('delete-all')} />
                  </div>

                  {activeAction === 'add' && rawNode && selectedOcc && (
                    <AddOccurrenceForm
                      onApply={(date, time, done) => { applyRawNode(doAddOccurrence(rawNode, selectedOcc.metadata._ownerPath, date, time, done)); setActiveAction(null) }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-occurrence' && rawNode && selectedOcc && (
                    <EditOccurrenceForm occ={selectedOcc}
                      onApply={(date, time, done) => { applyRawNode(doEditOccurrence(rawNode, selectedOcc.metadata._ownerPath, selectedOcc.date, date, time, done)); setActiveAction(null) }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-following' && rawNode && selectedOcc && (
                    <EditFollowingForm occ={selectedOcc}
                      onApply={() => { applyRawNode(doEditFollowing(rawNode, selectedOcc.metadata._ownerPath, selectedOcc.date)); setActiveAction(null) }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-occurrence' && rawNode && selectedOcc && (
                    <DeleteConfirmForm
                      message={selectedOcc.source === 'generated' ? `Mark ${selectedOcc.date} as excluded.` : `Remove explicit instance on ${selectedOcc.date}.`}
                      label="Delete occurrence"
                      onApply={() => { applyRawNode(doDeleteOccurrence(rawNode, selectedOcc.metadata._ownerPath, selectedOcc)); setActiveAction(null) }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-following' && rawNode && selectedOcc && (
                    <DeleteConfirmForm
                      message={`End the series on ${dayBefore(selectedOcc.date)}. Occurrences from ${selectedOcc.date} onwards will be removed.`}
                      label="Delete this & following"
                      onApply={() => { applyRawNode(doDeleteFollowing(rawNode, selectedOcc.metadata._ownerPath, selectedOcc.date)); setActiveAction(null) }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-all' && (
                    <DeleteConfirmForm
                      message="Delete the entire node. Use Original to restore the loaded file."
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
                onChange={(updater) => setDebugEntry(prev => prev ? updater(prev) : prev)}
                onSave={handleDebugSave}
                onDelete={handleDebugDelete}
                onClose={handleDebugClose}
                onOpenDlg={setDebugDialog}
                onOpenRepeatDlg={() => setDebugDialog('dlgRepeat')}
                onScopeChange={handleDebugScopeChange}
                seriesRepeat={selectedPattern?.repeat ?? null}
              />
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
                {occurrences && occurrences.length > 0 ? 'Select an occurrence to edit' : displayContent ? '' : 'Load a file to begin'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* RepeatDialog for "Edit pattern" action (3rd column) */}
      {rawNode && selectedOcc && (
        <RepeatDialog
          open={patternDialogOpen}
          scheduled={{ date: selectedOcc.date, time: selectedOcc.time || '' }}
          tracked={selectedOcc.metadata.done !== undefined}
          repeat={selectedPattern?.repeat ?? null}
          onConfirm={r => { applyRawNode(doEditPattern(rawNode, selectedOcc.metadata._ownerPath, r)); setPatternDialogOpen(false); setActiveAction(null) }}
          onRemove={() => setPatternDialogOpen(false)}
          onClose={() => { setPatternDialogOpen(false); setActiveAction(null) }}
        />
      )}
    </div>
  )
}
