import { useState, useCallback, useMemo } from 'react'
import {
  Upload, ChevronRight, ChevronLeft, AlertCircle, RotateCcw,
  CalendarDays, Plus, Pencil, Repeat, ChevronsRight, Trash2,
} from 'lucide-react'
import {
  buildEffectiveTree, type EffectiveNode,
  expandRange, treeHasOccurrences,
  collapseToYaml,
  parseToStoreItems,
  applyEdit, excludeOccurrence, deleteFollowing, findSeries, seriesContext, upsertOverride, type EditFields,
  dayBefore,
  saveFile,
} from '@/model'
import { loadFile, entryKey as makeEntryKey } from '@/fileIO'
import { cn } from '@/lib/cn'
import type { Occurrence, Repeat as RepeatType, StoreItem, Roots, Entries, FileMetadata, EditScope, OccurrenceEntry, RepeatPattern, OccurrenceMetadata } from '@/types'
import { EntryEditor, RepeatDialog, applyScope, entryFromOccurrence, usePendingLinks } from '@/editor'
import type { EntryState, EntryEditorHooks } from '@/editor'
import { flattenForDisplay, NodeCard } from './DebuggerNodeTree'
import { OccurrenceRow } from './DebuggerOccurrenceRow'
import { ActionBtn, AddOccurrenceForm, EditOccurrenceForm, EditFollowingForm, DeleteConfirmForm } from './DebuggerActionForms'
import { useDebugDialogHandlers } from './useDebugDialogHandlers'

// ── Misc helpers ──────────────────────────────────────────────────────────────

function defaultEndDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + 3)
  return d.toISOString().slice(0, 10)
}

// The debugger edits a scratch snapshot, not a real vault — but entry identity
// is vault-qualified everywhere, so the scratch file needs a vault of its own.
// A dedicated id keeps it from ever colliding with a real one.
const DEBUG_VAULT_ID  = 'debug'
const DEBUG_FILE_SLUG = 'debug-node'
const DEBUG_KEY       = makeEntryKey(DEBUG_VAULT_ID, DEBUG_FILE_SLUG)
/** Stands in until a file is parsed, so the debugger's one entry is always whole. */
const EMPTY_DEBUG_ROOT: FileMetadata = {
  title: '', tags: [], items: [], vaultId: DEBUG_VAULT_ID, fileSlug: DEBUG_FILE_SLUG,
}

/**
 * Serialize items back to YAML content string (same path as writeEntityToCache).
 */
function itemsToYaml(items: StoreItem[], root: FileMetadata | undefined, body: string): string {
  // The debugger's list is empty until a file is parsed. That guard was always
  // here; it now also does the narrowing `collapseToYaml` needs.
  const [head, ...tail] = items
  if (!head) return ''
  const frontmatter = collapseToYaml([head, ...tail], root)
  return saveFile(frontmatter, body, root?.fileConvention)
}

// ── Action types ──────────────────────────────────────────────────────────────

type ActionKind =
  | 'add' | 'edit-occurrence' | 'edit-pattern' | 'edit-following'
  | 'delete-occurrence' | 'delete-following' | 'delete-all'

// ── Main component ────────────────────────────────────────────────────────────

export default function NodeInheritanceDebugger() {
  const [displayContent,  setDisplayContent]  = useState<string>('')
  const [fileName,        setFileName]        = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [isCollapsed,     setIsCollapsed]     = useState(false)
  const [parseErrors,     setParseErrors]     = useState<string[]>([])
  const [items,           setItems]           = useState<StoreItem[]>([])
  const [debugRoot,       setDebugRoot]       = useState<FileMetadata | undefined>(undefined)
  // The debugger drives storeOps against a single synthetic entry, so it packs
  // its local item list and root into `Entries` on the way in and unpacks the
  // one entry on the way out.
  // Empty until a file is parsed, and `Entry['items']` is non-empty — so an
  // unparsed debugger has no entry at all, which is the same answer the store
  // gives for a file that has not been read yet.
  const debugEntries = useMemo<Entries>(() => {
    const [head, ...tail] = items
    if (!head) return new Map()
    return new Map([[DEBUG_KEY, { key: DEBUG_KEY, root: debugRoot ?? EMPTY_DEBUG_ROOT, items: [head, ...tail] }]])
  }, [debugRoot, items])
  /** The flat view `expandRange` and `EntryEditor` still take. */
  const debugRoots = useMemo<Roots>(() => new Map([[DEBUG_KEY, debugRoot ?? EMPTY_DEBUG_ROOT]]), [debugRoot])
  const [expandEndDate,   setExpandEndDate]   = useState<string>(defaultEndDate)
  const [selectedIdx,     setSelectedIdx]     = useState<number | null>(null)
  const [activeAction,    setActiveAction]    = useState<ActionKind | null>(null)

  // ── 4th-column EntryEditor state ─────────────────────────────────────────
  const [debugEntry,        setDebugEntry]        = useState<EntryState | null>(null)
  const [patternDialogOpen, setPatternDialogOpen] = useState(false)
  const { handlers: dialogHandlers, openDialog, openRepeatDialog } = useDebugDialogHandlers(setDebugEntry)
  const debugPendingLinks = usePendingLinks(debugEntry?.item ?? null, debugEntry?.title ?? '', DEBUG_VAULT_ID)

  // ── Effective tree for viz column — re-derived from displayContent ────────
  const results = useMemo<EffectiveNode | null>(() => {
    if (!displayContent) return null
    try {
      const { rawNode } = loadFile(fileName || 'debug.md', displayContent)
      return buildEffectiveTree(rawNode)
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
      const parsed = parseToStoreItems(name || 'debug.md', content, DEBUG_VAULT_ID)
      // Assign a stable debug key so expandRange can match series↔overrides.
      const withKey = parsed.items.map(i => ({ ...i, entryKey: i.entryKey || DEBUG_KEY }))
      setItems(withKey)
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
      tags:         tags,
      items:        listItems,
      participants: participants,
      body,
      tracked:  tracked,
      done:     done,
      priority: priority ?? null,
      scheduled: scheduled ?? null,
      duration: duration || '',
      repeat:   repeat ?? null,
    }
    const next = applyEdit({ entries: debugEntries }, selectedOcc, editScope, fields, { vaultId: DEBUG_VAULT_ID })
    const entry = next.entries.get(DEBUG_KEY)
    applyItems(entry?.items ?? [], entry?.root, body)
  }, [debugEntry, selectedOcc, debugEntries, applyItems])

  const handleDebugScopeChange = useCallback((scope: EditScope) => {
    setDebugEntry(prev => {
      if (!prev?.item) return prev
      const occ = prev.item
      const { scheduled, repeat } = applyScope(occ, scope, items)
      if (scope === 'future' || scope === 'all') {
        // File-level fields (title/tags/body) come from debugRoot; occurrence fields from series.
        const pm = selectedSeries?.metadata
        return {
          ...prev, editScope: scope, scheduled, repeat,
          title:    debugRoot?.title ?? prev.title,
          tags:     debugRoot?.tags  ? [...debugRoot.tags] : prev.tags,
          priority: (pm?.priority ?? prev.priority ?? null),
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
          {isCollapsed && <span className="text-2xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">collapsed</span>}
        </>)}
        <div className="ml-auto flex items-center gap-2">
          {isCollapsed && (
            <button type="button" onClick={handleReset} title="Reset to original file"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/60 transition-colors">
              <RotateCcw size={12} /> Original
            </button>
          )}
          <label className="cursor-pointer flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/15 text-xs text-white/80 transition-colors">
            <Upload size={13} /> Load file
            <input type="file" accept=".md" className="hidden" onChange={handleFileChange} />
          </label>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">

        {/* LEFT: source */}
        <div className="w-[20%] flex flex-col border-r border-white/10 min-h-0">
          <div className="px-3 py-2 text-2xs uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0">
            {isCollapsed ? 'Collapsed YAML' : 'Source'}
          </div>
          <div className="flex-1 overflow-auto">
            {isEmpty ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/25 select-none">
                <Upload size={32} strokeWidth={1.2} />
                <span className="text-sm">Drop a .md file here</span>
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
          <button type="button" onClick={handleCollapse} disabled={items.length === 0}
            title={items.length > 0 ? 'Collapse effective nodes → compact YAML' : 'Load a file first'}
            className={cn(
              'flex items-center justify-center w-6 h-6 rounded transition-colors',
              items.length > 0 ? 'text-white/50 hover:text-white hover:bg-white/10 cursor-pointer' : 'text-white/15 cursor-not-allowed'
            )}>
            <ChevronLeft size={14} />
          </button>
        </div>

        {/* MIDDLE: effective tree */}
        <div className="w-[24%] flex flex-col border-r border-white/10 min-h-0">
          <div className="px-3 py-2 text-2xs uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0 flex items-center gap-2">
            Effective tree
            {displayItems.length > 0 && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono normal-case tracking-normal">
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
                  {parseErrors.map(err => <li key={err} className="text-xs font-mono text-red-300/80">{err}</li>)}
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
              return <NodeCard key={item.label} item={item} isLast={isLast} />
            })}
          </div>
        </div>

        {/* 3RD COLUMN: occurrences */}
        <div className="w-[22%] flex flex-col min-h-0 border-r border-white/10">
          <div className="px-3 py-2 text-2xs uppercase tracking-widest text-white/30 border-b border-white/10 shrink-0 flex items-center gap-2">
            <CalendarDays size={12} className="text-white/30" />
            <span>Occurrences</span>
            {occurrences && occurrences.length > 0 && (
              <span className="text-2xs px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono normal-case tracking-normal">
                {occurrences.length}
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <input type="date" value={expandEndDate} onChange={e => setExpandEndDate(e.target.value)}
                className="bg-white/5 border border-white/10 rounded px-2 py-0.5 text-2xs font-mono text-white/60 focus:outline-none focus:border-white/25 normal-case tracking-normal" />
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
                    <OccurrenceRow key={`${occ.entryKey}-${occ.date}`} occ={occ} isSelected={selectedIdx === i} onClick={() => handleSelectOccurrence(i)} />
                  ))
            )}
          </div>

          {displayContent && parseErrors.length === 0 && (
            <div className="shrink-0 border-t border-white/10 bg-[#0d1015]">
              {selectedOcc === null ? (
                <div className="px-3 py-2.5 text-2xs text-white/20 select-none">
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

                  {activeAction === 'add' && (
                    <AddOccurrenceForm
                      onApply={(date, time, done) => {
                        const series = findSeries(items, selectedOcc)
                        const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
                          date, time: time || null, source: 'explicit',
                          entryKey: selectedOcc.entryKey, id: crypto.randomUUID(),
                          ownerId: selectedOcc.ownerId,
                          metadata: { ...(series?.metadata ?? {}), done, participants: [] },
                        }
                        const next = [...items, newOcc]
                        applyItems(next, debugRoot, debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-occurrence' && (
                    <EditOccurrenceForm occ={selectedOcc}
                      onApply={(date, time, done) => {
                        const entry = debugEntries.get(DEBUG_KEY)
                        const next = entry
                          ? upsertOverride(entry.items, selectedOcc, {
                            date, time: time || null,
                            metadata: { ...selectedOcc.metadata, done },
                          })
                          : items
                        applyItems(next, debugRoot, debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'edit-following' && (
                    <EditFollowingForm occ={selectedOcc}
                      onApply={() => {
                        const next = deleteFollowing({ entries: debugEntries }, selectedOcc)
                        const entry = next.entries.get(DEBUG_KEY)
                        applyItems(entry?.items ?? [], entry?.root, debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-occurrence' && (
                    <DeleteConfirmForm
                      message={selectedOcc.source === 'generated' ? `Mark ${selectedOcc.date} as excluded.` : `Remove explicit instance on ${selectedOcc.date}.`}
                      label="Delete occurrence"
                      onApply={() => {
                        const next = excludeOccurrence({ entries: debugEntries }, selectedOcc)
                        const entry = next.entries.get(DEBUG_KEY)
                        applyItems(entry?.items ?? [], entry?.root, debugRoot?.body ?? '')
                        setActiveAction(null)
                      }}
                      onCancel={() => setActiveAction(null)} />
                  )}
                  {activeAction === 'delete-following' && (
                    <DeleteConfirmForm
                      message={`End the series on ${dayBefore(selectedOcc.date)}. Occurrences from ${selectedOcc.date} onwards will be removed.`}
                      label="Delete this & following"
                      onApply={() => {
                        const next = deleteFollowing({ entries: debugEntries }, selectedOcc)
                        const entry = next.entries.get(DEBUG_KEY)
                        applyItems(entry?.items ?? [], entry?.root, debugRoot?.body ?? '')
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
            <EntryEditor
              hooks={{
                entry: debugEntry,
                series: seriesContext(items, debugEntry.item),
                vaultId: DEBUG_VAULT_ID,
                // The debugger pins one synthetic vault, so there is nowhere to
                // retarget or move to.
                onVaultChange: null,
                pendingMove: null,
                onMoveConfirm: () => {},
                onMoveCancel: () => {},
                pendingLinks: debugPendingLinks,
                // Creating a list writes a real vault file — same reason
                // handlePromoteTask below stands down.
                handleCreateList: null,
                dialogHandlers,
                setEntry: (updater) => setDebugEntry(prev => prev ? updater(prev) : prev),
                handleSave: handleDebugSave,
                handleOpenDlg: openDialog,
                handleOpenRepeatDlg: openRepeatDialog,
                // Promoting a checklist line creates a real vault file and navigates to
                // it — out of scope for the debugger, which edits a scratch snapshot.
                handlePromoteTask: () => null,
                scheduleAutoSave: () => {},
                saveMeta: () => {},
                handleScopeChange: handleDebugScopeChange,
                handleTypeChange: () => {},
                handleDoneToggle: () => {},
                // The scratch snapshot below is never archived, so this never fires —
                // a no-op like handleDoneToggle above, not a genuine absence.
                handleUnarchive: () => {},
                // The debugger edits a scratch snapshot outside any real vault, so
                // there is nowhere for a wikilink to navigate to — genuinely absent,
                // not a no-op (see ListedOnRow's onNavigate truthiness check).
                handleOpenWikilink: null,
                handleToggleDoneBacklink: () => {},
                titleMissing: false,
                focusTitleTick: 0,
              } satisfies EntryEditorHooks}
              items={items}
              roots={debugRoots}
            />
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
