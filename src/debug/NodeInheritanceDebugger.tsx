import { useState, useCallback, useMemo } from 'react'
import { Upload, FileText, ChevronRight, ChevronLeft, AlertCircle, RotateCcw, CalendarDays } from 'lucide-react'
import { RawNodeSchema, type RawNode } from './nodeSchema'
import { buildEffectiveTree, collapseToYaml, displayValue, type EffectiveNode } from './inheritance'
import { expandRepeat, hasRepeat, type OccurrenceEntry } from './repeatExpander'
import { yamlParse } from '../yaml'

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Flatten tree for display ──────────────────────────────────────────────────

interface CardItem {
  label:         string
  depth:         number
  fields:        Record<string, unknown>
  instanceCount: number
}

function flattenForDisplay(
  node: EffectiveNode,
  depth      = 0,
  pathParts: string[] = [],
): CardItem[] {
  const label = pathParts.length === 0 ? 'root' : pathParts.join(' › ')
  const items: CardItem[] = [{ label, depth, fields: node.fields, instanceCount: node.instances.length }]
  node.instances.forEach((child, i) => {
    items.push(...flattenForDisplay(child, depth + 1, [...pathParts, `instances[${i}]`]))
  })
  return items
}

// ── Depth colour bar ──────────────────────────────────────────────────────────

const DEPTH_COLOURS = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500']
const depthColour   = (d: number) => DEPTH_COLOURS[d % DEPTH_COLOURS.length]

// ── Tree node card ────────────────────────────────────────────────────────────

function NodeCard({ item, isLast }: { item: CardItem; isLast: boolean }) {
  const { label, depth, fields, instanceCount } = item
  const entries = Object.entries(fields)
  const indent  = depth * 20   // px per depth level

  return (
    <div className="flex items-start" style={{ paddingLeft: `${indent}px` }}>
      {/* Connector line + dot for non-root */}
      {depth > 0 && (
        <div className="flex flex-col items-center mr-2 shrink-0" style={{ width: 16 }}>
          <div className={`w-px bg-white/10 ${isLast ? 'h-4' : 'flex-1'}`} style={{ minHeight: 16 }} />
          <div className="w-2 h-px bg-white/10" />
        </div>
      )}

      <div className="flex-1 rounded-lg border border-white/10 bg-white/5 overflow-hidden mb-2">
        {/* Card header */}
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

        {/* Fields */}
        {entries.length === 0 ? (
          <div className="px-3 py-2 text-xs text-white/30 italic">no fields</div>
        ) : (
          <div className="divide-y divide-white/5">
            {entries.map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 px-3 py-1.5 text-xs font-mono">
                <span className="text-sky-300 shrink-0 w-28 truncate" title={key}>{key}</span>
                <span
                  className="text-white/80 flex-1 whitespace-pre-wrap break-all"
                  title={JSON.stringify(value)}
                >
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

// ── Occurrence row ────────────────────────────────────────────────────────────

function OccurrenceRow({ occ }: { occ: OccurrenceEntry }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 border-b border-white/5 text-xs font-mono ${occ.done ? 'opacity-40' : ''}`}>
      <span className={`shrink-0 ${occ.done ? 'line-through' : ''} text-white/80`}>{occ.date}</span>
      {occ.time
        ? <span className="text-white/40 shrink-0">{occ.time}</span>
        : <span className="text-white/15 shrink-0">—</span>
      }
      {occ.done && (
        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-sans">done</span>
      )}
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
  const [expandEndDate,   setExpandEndDate]   = useState<string>(defaultEndDate)

  // ── Parse + build effective tree ──────────────────────────────────────────
  const processContent = useCallback((content: string, name: string) => {
    setDisplayContent(content)
    setFileName(name)
    setZodErrors([])
    setResults(null)
    setIsCollapsed(false)

    const { fm } = extractFrontmatter(content)
    let parsed: unknown
    try {
      parsed = yamlParse(fm)
    } catch (e) {
      setZodErrors([`YAML parse error: ${String(e)}`])
      return
    }

    const validation = RawNodeSchema.safeParse(parsed)
    if (!validation.success) {
      setZodErrors(validation.error.errors.map(e => `${e.path.join('.')}: ${e.message}`))
      return
    }

    setResults(buildEffectiveTree(validation.data as RawNode))
  }, [])

  // ── Collapse back to YAML ─────────────────────────────────────────────────
  const handleCollapse = useCallback(() => {
    if (!results) return
    const { body } = extractFrontmatter(originalContent || displayContent)
    const collapsed = collapseToYaml(results, body)
    setDisplayContent(collapsed)
    setIsCollapsed(true)

    const { fm } = extractFrontmatter(collapsed)
    try {
      const parsed     = yamlParse(fm)
      const validation = RawNodeSchema.safeParse(parsed)
      if (validation.success) {
        setResults(buildEffectiveTree(validation.data as RawNode))
        setZodErrors([])
      }
    } catch {
      // keep existing results if re-parse fails
    }
  }, [results, originalContent, displayContent])

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    if (originalContent) processContent(originalContent, fileName)
  }, [originalContent, fileName, processContent])

  // ── File input ────────────────────────────────────────────────────────────
  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    setOriginalContent(text)
    processContent(text, file.name)
    e.target.value = ''
  }, [processContent])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file) return
    const text = await file.text()
    setOriginalContent(text)
    processContent(text, file.name)
  }, [processContent])

  // ── Derived state ─────────────────────────────────────────────────────────
  const displayItems  = useMemo(() => results ? flattenForDisplay(results) : [], [results])
  const canCollapse   = results !== null
  const isEmpty       = !displayContent

  const nodeHasRepeat = results ? hasRepeat(results) : false
  const occurrences   = useMemo<OccurrenceEntry[] | null>(() => {
    if (!results || !nodeHasRepeat) return null
    return expandRepeat(results, expandEndDate)
  }, [results, nodeHasRepeat, expandEndDate])

  return (
    <div
      className="flex flex-col h-screen bg-[#111318] text-white"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ── Top bar ── */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <span className="text-sm font-semibold tracking-wide text-white/70" style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic' }}>
          Meridian
        </span>
        <ChevronRight size={14} className="text-white/30" />
        <span className="text-sm text-white/50">Inheritance Debugger</span>
        {fileName && (
          <>
            <ChevronRight size={14} className="text-white/30" />
            <span className="text-sm font-mono text-white/70">{fileName}</span>
            {isCollapsed && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">collapsed</span>
            )}
          </>
        )}
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
        <div className="w-[28%] flex flex-col border-r border-white/10 min-h-0">
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
              <pre className="p-4 text-xs leading-5 text-white/70 whitespace-pre-wrap break-all" style={{ fontFamily: 'DM Mono, monospace' }}>
                {displayContent}
              </pre>
            )}
          </div>
        </div>

        {/* Divider with ‹ button */}
        <div className="flex flex-col items-center justify-center w-8 shrink-0 border-r border-white/10 bg-white/[0.02]">
          <button
            onClick={handleCollapse}
            disabled={!canCollapse}
            title={canCollapse ? 'Collapse effective nodes → compact YAML' : 'Load a file first'}
            className={`flex items-center justify-center w-6 h-6 rounded transition-colors ${
              canCollapse ? 'text-white/50 hover:text-white hover:bg-white/10 cursor-pointer' : 'text-white/15 cursor-not-allowed'
            }`}
          >
            <ChevronLeft size={14} />
          </button>
        </div>

        {/* MIDDLE: effective nodes */}
        <div className="w-[30%] flex flex-col border-r border-white/10 min-h-0">
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
                  {zodErrors.map((err, i) => (
                    <li key={i} className="text-xs font-mono text-red-300/80">{err}</li>
                  ))}
                </ul>
              </div>
            )}
            {!displayContent && zodErrors.length === 0 && (
              <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">
                Load a file to see effective nodes
              </div>
            )}
            {displayItems.map((item, i) => {
              const nextItem    = displayItems[i + 1]
              const isLast      = !nextItem || nextItem.depth < item.depth
              return <NodeCard key={i} item={item} isLast={isLast} />
            })}
          </div>
        </div>

        {/* RIGHT: repeat expansion */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 text-[11px] uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0 flex items-center gap-2">
            <CalendarDays size={12} className="text-white/30" />
            <span>Repeat expansion</span>
            {occurrences && occurrences.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono normal-case tracking-normal">
                {occurrences.length}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <span className="text-[10px] text-white/25 normal-case tracking-normal">until</span>
              <input
                type="date"
                value={expandEndDate}
                onChange={e => setExpandEndDate(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-[11px] font-mono text-white/60 focus:outline-none focus:border-white/25 normal-case tracking-normal"
              />
            </div>
          </div>
          <div className="flex-1 overflow-auto">
            {!displayContent && (
              <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">
                Load a file to see repeat expansion
              </div>
            )}
            {displayContent && !nodeHasRepeat && zodErrors.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-white/20 select-none">
                <CalendarDays size={28} strokeWidth={1.2} />
                <span className="text-sm">No <span className="font-mono">repeat:</span> field defined</span>
              </div>
            )}
            {occurrences !== null && (
              occurrences.length === 0 ? (
                <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">
                  No occurrences before {expandEndDate}
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {occurrences.map((occ, i) => <OccurrenceRow key={i} occ={occ} />)}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
