import { useState, useCallback, useMemo } from 'react'
import {
  Upload, FileText, ChevronRight, ChevronLeft, AlertCircle, RotateCcw,
  CalendarDays, Plus, Pencil, Repeat, ChevronsRight, Trash2,
} from 'lucide-react'
import {
  buildEffectiveTree, displayValue, type EffectiveNode,
  expandRange, treeHasOccurrences,
  collapseToYaml,
  parseToStoreItems,
  applyEdit, excludeOccurrence, deleteFollowing, findSeries, upsertOverride, type EditFields,
  dayBefore,
  saveFile,
} from '@/model'
import { loadFile } from '@/fileIO'
import type { Occurrence, Priority, Repeat as RepeatType, StoreItem, Roots, FileMetadata, EditScope, OccurrenceEntry, RepeatPattern, OccurrenceMetadata } from '@/types'
import { EntryEditor, DialogStack, RepeatDialog, applyScope, entryFromOccurrence } from '@/editor'
import type { EntryState, DialogHandlers } from '@/editor'

// ── Misc helpers ──────────────────────────────────────────────────────────────

function defaultEndDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

const DEBUG_FILE_SLUG = 'debug-node'

/**
 * Serialize items back to YAML content string (same path as writeEntityToCache).
 */
function itemsToYaml(items: StoreItem[], root: FileMetadata | undefined, body: string): string {
  if (items.length === 0) return ''
  const frontmatter = collapseToYaml(items, root)
  return saveFile(frontmatter, body)
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
  occ: Occurrence
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
  occ: Occurrence
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
  occ: Occurrence
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

// ── Dialog state hook ─────────────────────────────────────────────────────────
//
// Manages the activeDialog open/close state and assembles the DialogHandlers
// object that DialogStack expects, keeping this glue out of the main component.

function useDebugDialogHandlers(
  setEntry: React.Dispatch<React.SetStateAction<EntryState | null>>,
) {
  const [activeDialog, setActiveDialog] = useState<string | null>(null)

  const handlers: DialogHandlers = {
    activeDialog,
    pendingDelete:    null,
    seriesSheetConfig: null,
    onClose:       () => setActiveDialog(null),
    onDateConfirm: date => { setEntry(e => e ? { ...e, scheduled: { date, time: e.scheduled?.time || '' } } : e); setActiveDialog(null) },
    onDateRemove:  ()   => { setEntry(e => e ? { ...e, scheduled: null, duration: '' } : e); setActiveDialog(null) },
    onPriority:    p    => { setEntry(e => e ? { ...e, priority: p } : e); setActiveDialog(null) },
    onTimeConfirm: time => { setEntry(e => e?.scheduled ? { ...e, scheduled: { ...e.scheduled, time } } : e) },
    onTimeRemove:  ()   => { setEntry(e => e?.scheduled ? { ...e, scheduled: { ...e.scheduled, time: '' } } : e) },
    onDurConfirm:  dur  => { setEntry(e => e ? { ...e, duration: dur } : e) },
    onDurRemove:   ()   => { setEntry(e => e ? { ...e, duration: '' } : e) },
    onRepeatConfirm: r  => { setEntry(e => e ? { ...e, repeat: r } : e); setActiveDialog(null) },
    onRepeatRemove: ()  => { setEntry(e => e ? { ...e, repeat: null } : e); setActiveDialog(null) },
    onSeriesClose: () => {},
    onDeleteClose: () => {},
  }

  const openDialog      = (id: string) => setActiveDialog(id)
  const openRepeatDialog = () => setActiveDialog('dlgRepeat')

  return { handlers, openDialog, openRepeatDialog }
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NodeInheritanceDebugger() {
  const [displayContent,  setDisplayContent]  = useState<string>('')
  const [fileName,        setFileName]        = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [isCollapsed,     setIsCollapsed]     = useState(false)
  const [parseErrors,     setParseErrors]     = useState<string[]>([])
  const [items,           setItems]           = useState<StoreItem[]>([])
  const [debugRoot,       setDebugRoot]       = useState<FileMetadata | undefined>(undefined)
  const debugRoots = useMemo<Roots>(() => debugRoot ? new Map([[DEBUG_FILE_SLUG, debugRoot]]) : new Map(), [debugRoot])
  const [expandEndDate,   setExpandEndDate]   = useState<string>(defaultEndDate)
  const [selectedIdx,     setSelectedIdx]     = useState<number | null>(null)
  const [activeAction,    setActiveAction]    = useState<ActionKind | null>(null)

  // ── 4th-column EntryEditor state ─────────────────────────────────────────
  const [debugEntry,        setDebugEntry]        = useState<EntryState | null>(null)
  const [patternDialogOpen, setPatternDialogOpen] = useState(false)
  const { handlers: dialogHandlers, openDialog, openRepeatDialog } = useDebugDialogHandlers(setDebugEntry)

  // ── Effective tree for viz column — re-derived from displayContent ────────
  const results = useMemo<EffectiveNode | null>(() => {
    if (!displayContent) return null
    try {
      const { rawNode } = loadFile(fileName || 'debug.md', displayContent)
      return buildEffectiveTree(rawNode as Parameters<typeof buildEffectiveTree>[0])
    } catch { return null }
  }, [displayContent, fileName])

  // ── Apply items → update displayContent + collapse state ─────────────────
  const applyItems = useCallback((newItems: StoreItem[], root: FileMetadata | undefined, body: string) => {
    setItems(newItems)
    setDebugRoot(root)
    const content = itemsToYaml(newItems, root, body)
    setDisplayContent(content)
    setIsCollapsed(true)
    setSelectedIdx(null)
    setDebugEntry(null)
    setActiveAction(null)
  }, [])

  // ── Parse ────────────────────────────────────────────────────────────────
  const processContent = useCallback((content: string, name: string) => {
    setDisplayContent(content)
    setFileName(name)
    setParseErrors([])
    setIsCollapsed(false)
    setSelectedIdx(null)
    setActiveAction(null)
    setDebugEntry(null)
    setItems([])
    setDebugRoot(undefined)

    try {
      const parsed = parseToStoreItems(name || 'debug.md', content)
      // Assign a stable debug fileSlug so expandRange can match series↔overrides.
      const withSlug = parsed.items.map(i => ({ ...i, fileSlug: i.fileSlug || DEBUG_FILE_SLUG }))
      setItems(withSlug)
      setDebugRoot(parsed.root)
    } catch (e) {
      setParseErrors([`Parse error: ${String(e)}`])
    }
  }, [])

  const handleCollapse = useCallback(() => {
    const body = debugRoot?.body ?? ''
    const content = itemsToYaml(items, debugRoot, body)
    setDisplayContent(content)
    setIsCollapsed(true)
    setSelectedIdx(null)
    setActiveAction(null)
  }, [items, debugRoot])

  const handleReset = useCallback(() => {
    if (originalContent) processContent(originalContent, fileName)
  }, [originalContent, fileName, processContent])

  const handleDeleteAll = useCallback(() => {
    setDisplayContent(''); setFileName(''); setOriginalContent('')
    setItems([]); setParseErrors([])
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
  const displayItems = useMemo(() => results ? flattenForDisplay(results) : [], [results])
  const isEmpty      = !displayContent
  const nodeHasRepeat = results ? treeHasOccurrences(results) : false

  const occurrences = useMemo<Occurrence[] | null>(() => {
    if (items.length === 0) return null
    const from = new Date(2000, 0, 1)
    const to   = new Date(`${expandEndDate}T23:59:59`)
    if (isNaN(to.getTime())) return []
    return expandRange(items, debugRoots, from, to)
  }, [items, debugRoots, expandEndDate])

  // Derived selection state — before all callbacks that depend on it.
  const selectedOcc    = selectedIdx !== null ? (occurrences ?? [])[selectedIdx] ?? null : null
  const selectedSeries = useMemo<RepeatPattern<OccurrenceMetadata> | null>(
    () => selectedOcc ? findSeries(items, selectedOcc) ?? null : null,
    [selectedOcc, items],
  )

  // ── Selection ────────────────────────────────────────────────────────────
  const handleSelectOccurrence = useCallback((idx: number) => {
    if (selectedIdx === idx) {
      setSelectedIdx(null); setActiveAction(null); setDebugEntry(null)
    } else {
      setSelectedIdx(idx); setActiveAction(null)
      const occEntry = (occurrences ?? [])[idx]
      if (occEntry) {
        setDebugEntry(entryFromOccurrence(occEntry, 'single', items))
      }
    }
  }, [selectedIdx, occurrences, items])

  // ── EntryEditor handlers ─────────────────────────────────────────────────
  const handleDebugSave = useCallback((body: string) => {
    if (!debugEntry || !selectedOcc) return
    const { title, tags, items: listItems, participants, tracked, done, priority, scheduled, duration, repeat, editScope } = debugEntry
    const fields: EditFields = {
      title:        title || '',
      tags:         tags || [],
      items:        listItems || [],
      participants: participants || [],
      body,
      tracked:  tracked ?? false,
      done:     done ?? false,
      priority: priority ?? null,
      scheduled: scheduled ?? null,
      duration: duration || '',
      repeat:   repeat ?? null,
    }
    const next = applyEdit({ items, roots: debugRoots }, selectedOcc, editScope, fields)
    applyItems(next.items, next.roots.get(DEBUG_FILE_SLUG), body)
  }, [debugEntry, selectedOcc, items, debugRoots, applyItems])

  const handleDebugScopeChange = useCallback((scope: EditScope) => {
    setDebugEntry(prev => {
      if (!prev?.item) return prev
      const occ = prev.item as Occurrence
      const { scheduled, repeat } = applyScope(occ, scope, items)
      if (scope === 'future' || scope === 'all') {
        // File-level fields (title/tags/body) come from debugRoot; occurrence fields from series.
        const pm = selectedSeries?.metadata
        return {
          ...prev, editScope: scope, scheduled, repeat,
          title:    debugRoot?.title ?? prev.title,
          tags:     debugRoot?.tags  ? [...debugRoot.tags] : prev.tags,
          priority: (pm?.priority ?? prev.priority ?? null) as Priority | null,
          body: debugRoot?.body  ?? prev.body,
          duration: pm?.duration ?? prev.duration,
          tracked:  prev.tracked,
          done:     pm?.done ?? prev.done,
        }
      }
      return { ...prev, editScope: scope, scheduled, repeat }
    })
  }, [selectedSeries, debugRoot, items])

  const canEditPattern     = selectedOcc?.source === 'generated'
  const canEditFollowing   = selectedOcc !== null && selectedSeries !== null
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
          style={{ fontSize: '18px' }}>Meridian</span>
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
          <button onClick={handleCollapse} disabled={items.length === 0}
            title={items.length > 0 ? 'Collapse effective nodes → compact YAML' : 'Load a file first'}
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
              items.length > 0 ? 'text-white/50 hover:text-white hover:bg-white/10 cursor-pointer' : 'text-white/15 cursor-not-allowed'
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
            {parseErrors.length > 0 && (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle size={14} className="text-red-400" />
                  <span className="text-xs font-semibold text-red-300">Parse / validation errors</span>
                </div>
                <ul className="space-y-1">
                  {parseErrors.map((err, i) => <li key={i} className="text-xs font-mono text-red-300/80">{err}</li>)}
                </ul>
              </div>
            )}
            {!displayContent && parseErrors.length === 0 && (
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
            {displayContent && !nodeHasRepeat && parseErrors.length === 0 && (
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

          {displayContent && parseErrors.length === 0 && (
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

                  {activeAction === 'add' && selectedOcc && (
                    <AddOccurrenceForm
                      onApply={(date, time, done) => {
                        const series = findSeries(items, selectedOcc)
                        const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
                          date, time: time || null, source: 'explicit',
                          fileSlug: selectedOcc.fileSlug, id: crypto.randomUUID(),
                          ownerId: selectedOcc.ownerId,
                          metadata: { ...(series?.metadata ?? {}), done, participants: [] },
                        }
                        const next = [...items, newOcc]
                        applyItems(next, debugRoot, debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-occurrence' && selectedOcc && (
                    <EditOccurrenceForm occ={selectedOcc}
                      onApply={(date, time, done) => {
                        const next = upsertOverride(items, selectedOcc, {
                          date, time: time || null,
                          metadata: { ...selectedOcc.metadata, done },
                        })
                        applyItems(next, debugRoot, debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-following' && selectedOcc && (
                    <EditFollowingForm occ={selectedOcc}
                      onApply={() => {
                        const next = deleteFollowing({ items, roots: debugRoots }, selectedOcc)
                        applyItems(next.items, next.roots.get(DEBUG_FILE_SLUG), debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-occurrence' && selectedOcc && (
                    <DeleteConfirmForm
                      message={selectedOcc.source === 'generated' ? `Mark ${selectedOcc.date} as excluded.` : `Remove explicit instance on ${selectedOcc.date}.`}
                      label="Delete occurrence"
                      onApply={() => {
                        const next = excludeOccurrence({ items, roots: debugRoots }, selectedOcc)
                        applyItems(next.items, next.roots.get(DEBUG_FILE_SLUG), debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-following' && selectedOcc && (
                    <DeleteConfirmForm
                      message={`End the series on ${dayBefore(selectedOcc.date)}. Occurrences from ${selectedOcc.date} onwards will be removed.`}
                      label="Delete this & following"
                      onApply={() => {
                        const next = deleteFollowing({ items, roots: debugRoots }, selectedOcc)
                        applyItems(next.items, next.roots.get(DEBUG_FILE_SLUG), debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
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
                onOpenDlg={openDialog}
                onOpenRepeatDlg={openRepeatDialog}
                onScopeChange={handleDebugScopeChange}
                items={items}
                roots={debugRoots}
              />
              <DialogStack entry={debugEntry} handlers={dialogHandlers} />
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
      {selectedOcc && selectedSeries && (
        <RepeatDialog
          open={patternDialogOpen}
          scheduled={{ date: selectedOcc.date, time: selectedOcc.time || '' }}
          tracked={selectedOcc.metadata.done !== undefined}
          repeat={selectedSeries.repeat}
          onConfirm={(r: RepeatType) => {
            const next = items.map(i =>
              i.id === selectedSeries.id
                ? { ...i as RepeatPattern<OccurrenceMetadata>, repeat: r }
                : i,
            )
            applyItems(next, debugRoot, debugRoot?.body ?? '')
            setPatternDialogOpen(false); setActiveAction(null)
          }}
          onRemove={() => setPatternDialogOpen(false)}
          onClose={() => { setPatternDialogOpen(false); setActiveAction(null) }}
        />
      )}
    </div>
  )
}
