import { useState, useCallback } from 'react'
import { Upload, FileText, ChevronRight, AlertCircle } from 'lucide-react'
import { RawNodeSchema, type RawNode } from './nodeSchema'
import { flattenEffectiveNodes, displayValue, type EffectiveNodeResult } from './inheritance'
import { yamlParse } from '../yaml'

// ── Frontmatter extractor ─────────────────────────────────────────────────────

function extractFrontmatter(content: string): { fm: string; ok: boolean } {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (m) return { fm: m[1], ok: true }
  // .yaml / .yml files — entire content is the mapping
  return { fm: content, ok: true }
}

// ── Path label helper ─────────────────────────────────────────────────────────

function pathLabel(path: string[]): string {
  if (path.length === 0) return 'root'
  // ['instances','0','instances','1'] → 'instances[0] › instances[1]'
  const parts: string[] = []
  for (let i = 0; i < path.length; i += 2) {
    parts.push(`instances[${path[i + 1]}]`)
  }
  return parts.join(' › ')
}

// ── Depth colour bar ──────────────────────────────────────────────────────────

const DEPTH_COLOURS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
]
function depthColour(d: number) {
  return DEPTH_COLOURS[d % DEPTH_COLOURS.length]
}

// ── Individual effective-node card ────────────────────────────────────────────

function NodeCard({ result }: { result: EffectiveNodeResult }) {
  const { path, depth, fields, hasDefaults, childCount } = result
  const label = pathLabel(path)
  const entries = Object.entries(fields)

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 overflow-hidden mb-3">
      {/* Card header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 bg-white/5">
        <span className={`w-1.5 h-4 rounded-full shrink-0 ${depthColour(depth)}`} />
        <FileText size={13} className="text-white/40 shrink-0" />
        <span className="font-mono text-xs text-white/90 font-medium">{label}</span>
        <span className="ml-auto text-[10px] text-white/30 font-mono">depth {depth}</span>
        {hasDefaults && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono">
            defaults ↓
          </span>
        )}
        {childCount > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-mono">
            {childCount} {childCount === 1 ? 'child' : 'children'}
          </span>
        )}
      </div>

      {/* Fields table */}
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-xs text-white/30 italic">no fields</div>
      ) : (
        <div className="divide-y divide-white/5">
          {entries.map(([key, { value, inherited }]) => (
            <div
              key={key}
              className={`flex items-start gap-2 px-3 py-1.5 text-xs font-mono ${
                inherited ? 'opacity-50' : ''
              }`}
            >
              {/* Key */}
              <span className="text-sky-300 shrink-0 w-28 truncate" title={key}>
                {key}
              </span>

              {/* Value */}
              <span
                className="text-white/80 flex-1 whitespace-pre-wrap break-all"
                title={JSON.stringify(value)}
              >
                {displayValue(value)}
              </span>

              {/* Origin badge */}
              <span
                className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-sans ${
                  inherited
                    ? 'bg-violet-500/15 text-violet-400'
                    : 'bg-white/10 text-white/40'
                }`}
              >
                {inherited ? '↓ def' : 'own'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function NodeInheritanceDebugger() {
  const [rawContent, setRawContent] = useState<string>('')
  const [fileName, setFileName]     = useState<string>('')
  const [zodErrors, setZodErrors]   = useState<string[]>([])
  const [results, setResults]       = useState<EffectiveNodeResult[] | null>(null)

  const processContent = useCallback((content: string, name: string) => {
    setRawContent(content)
    setFileName(name)
    setZodErrors([])
    setResults(null)

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

    const node = validation.data as RawNode
    setResults(flattenEffectiveNodes(node))
  }, [])

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const text = await file.text()
      processContent(text, file.name)
      // Reset input so the same file can be reloaded
      e.target.value = ''
    },
    [processContent],
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (!file) return
      const text = await file.text()
      processContent(text, file.name)
    },
    [processContent],
  )

  const isEmpty = !rawContent

  return (
    <div
      className="flex flex-col h-screen bg-[#111318] text-white"
      style={{ fontFamily: 'DM Sans, sans-serif' }}
      onDragOver={e => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ── Top bar ── */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0">
        <span
          className="text-sm font-semibold tracking-wide text-white/70"
          style={{ fontFamily: 'Fraunces, serif', fontStyle: 'italic' }}
        >
          Meridian
        </span>
        <ChevronRight size={14} className="text-white/30" />
        <span className="text-sm text-white/50">Inheritance Debugger</span>
        {fileName && (
          <>
            <ChevronRight size={14} className="text-white/30" />
            <span className="text-sm font-mono text-white/70">{fileName}</span>
          </>
        )}
        <div className="ml-auto">
          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors">
            <Upload size={13} />
            Load file
            <input
              type="file"
              accept=".md,.yaml,.yml"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: raw content ── */}
        <div className="w-2/5 flex flex-col border-r border-white/10 min-h-0">
          <div className="px-3 py-2 text-[11px] uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0">
            Source
          </div>
          <div className="flex-1 overflow-auto">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/25 select-none">
                <Upload size={32} strokeWidth={1.2} />
                <span className="text-sm">Drop a .md / .yaml file here</span>
                <span className="text-xs">or use the Load file button</span>
              </div>
            ) : (
              <pre
                className="p-4 text-xs leading-5 text-white/70 whitespace-pre-wrap break-all"
                style={{ fontFamily: 'DM Mono, monospace' }}
              >
                {rawContent}
              </pre>
            )}
          </div>
        </div>

        {/* ── RIGHT: effective nodes ── */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 text-[11px] uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0 flex items-center gap-2">
            Effective nodes
            {results && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono normal-case tracking-normal">
                {results.length}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto p-4">
            {/* Zod / parse errors */}
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

            {/* Empty state */}
            {!rawContent && zodErrors.length === 0 && (
              <div className="flex items-center justify-center h-full text-white/20 text-sm select-none">
                Load a file to see effective nodes
              </div>
            )}

            {/* Node cards */}
            {results && results.map((r, i) => (
              <NodeCard key={i} result={r} />
            ))}
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      {results && (
        <footer className="flex items-center gap-4 px-4 py-2 border-t border-white/10 text-[10px] text-white/30 shrink-0">
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded bg-white/10 text-white/40 font-mono">own</span>
            field defined on this node
          </span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-mono">↓ def</span>
            inherited from ancestor defaults
          </span>
          <span className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 font-mono">defaults ↓</span>
            node carries a defaults block
          </span>
        </footer>
      )}
    </div>
  )
}
