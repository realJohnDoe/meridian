import { useState, useCallback, useEffect } from 'react'
import { useStore } from '../store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from '../mutations'
import type { SeriesSheetConfig } from '../mutations'
import type { Occurrence } from '../types'
import { buildBodyHtml, fileOccurrenceMap } from '../presentation'
import { fmtISO } from '../model/expansion'
import { TODAY } from '../constants'
import { resolveWikilink } from '../wikilinks'
import { type EntryState, ENTRY_DEFAULT } from '../components/EntryEditor'
import type { Priority } from '../types'

function entryFromItem(item: Occurrence | null, editScope: string): EntryState {
  if (!item) {
    return { ...ENTRY_DEFAULT, scheduled: { date: fmtISO(TODAY), time: '' } }
  }
  return entryFromOccurrence(item, editScope, buildBodyHtml)
}

export function useEntryEditor() {
  const [entry, setEntry] = useState<EntryState>(ENTRY_DEFAULT)
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void } | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

  const storeItems = useStore(s => s.items)
  const storeRoots = useStore(s => s.roots)
  const pushOverlay = useStore(s => s.pushOverlay)
  const popOverlay  = useStore(s => s.popOverlay)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveDialog(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const openEntry = useCallback((item: Occurrence | null, scope?: string, prefillTitle?: string) => {
    const editScope = scope ?? (item ? 'single' : 'all')
    const state = entryFromItem(item, editScope)
    setEntry(prefillTitle && !item ? { ...state, title: prefillTitle } : state)
    pushOverlay('entry')
  }, [pushOverlay])

  const handleOpenWikilink = useCallback((ref: string) => {
    const fileSlug = resolveWikilink(ref, storeRoots)
    if (!fileSlug) {
      // No matching file → render as wl-broken, click creates a new entry.
      openEntry(null, undefined, ref)
      return
    }
    // resolveWikilink matched a real file → fileOccurrenceMap is total over
    // roots, so .get() is guaranteed non-null (invariant: wl styling ⟺ opens existing).
    openEntry(fileOccurrenceMap(storeItems, storeRoots).get(fileSlug)!, 'single')
  }, [storeRoots, storeItems, openEntry])

  const handleSave = useCallback((body: string) => {
    saveNode(entry.item, entry.editScope, { ...entry, body })
  }, [entry])

  const handleDelete = useCallback(() => {
    deleteNode(
      entry.item,
      (config) => setSeriesSheetConfig(config),
      () => setSeriesSheetConfig(null),
      (title, onConfirm) => setPendingDelete({ title, onConfirm }),
    )
  }, [entry.item])

  const handleClose = useCallback(() => popOverlay(), [popOverlay])

  const handleScopeChange = useCallback((scope: string) => {
    setEntry(prev => {
      if (!prev.item) return prev
      const { scheduled, repeat } = applyScope(prev.item, scope)
      return { ...prev, editScope: scope, scheduled, repeat }
    })
  }, [])

  const handleOpenDlg = useCallback((id: string) => setActiveDialog(id), [])
  const handleOpenRepeatDlg = useCallback((_itemType?: string) => setActiveDialog('dlgRepeat'), [])
  const closeDialog = useCallback(() => setActiveDialog(null), [])

  const handleDateConfirm = useCallback((dateStr: string) => {
    setEntry(prev => ({ ...prev, scheduled: { date: dateStr, time: prev.scheduled?.time || '' } }))
    setActiveDialog(null)
  }, [])

  const handleDateRemove = useCallback(() => {
    setEntry(prev => ({ ...prev, scheduled: null, duration: '' }))
    setActiveDialog(null)
  }, [])

  const handleTimeConfirm = useCallback((hhmm: string) => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: hhmm } } : prev)
  }, [])

  const handleTimeRemove = useCallback(() => {
    setEntry(prev => prev.scheduled ? { ...prev, scheduled: { ...prev.scheduled, time: '' } } : prev)
  }, [])

  const handleDurConfirm = useCallback((dur: string) => setEntry(prev => ({ ...prev, duration: dur })), [])
  const handleDurRemove  = useCallback(() => setEntry(prev => ({ ...prev, duration: '' })), [])

  const handleRepeatConfirm = useCallback((repeat: EntryState['repeat']) => {
    setEntry(prev => ({ ...prev, repeat }))
    setActiveDialog(null)
  }, [])

  const handleRepeatRemove = useCallback(() => {
    setEntry(prev => ({ ...prev, repeat: null }))
    setActiveDialog(null)
  }, [])

  const handlePriority = useCallback((p: Priority | null) => {
    setEntry(prev => ({ ...prev, priority: p }))
    setActiveDialog(null)
  }, [])

  return {
    // state
    entry, setEntry,
    activeDialog,
    pendingDelete, setPendingDelete,
    seriesSheetConfig, setSeriesSheetConfig,
    // store refs needed by EntryEditor
    storeItems, storeRoots,
    // callbacks
    openEntry,
    handleOpenWikilink,
    handleSave,
    handleDelete,
    handleClose,
    handleScopeChange,
    handleOpenDlg,
    handleOpenRepeatDlg,
    closeDialog,
    handleDateConfirm,
    handleDateRemove,
    handleTimeConfirm,
    handleTimeRemove,
    handleDurConfirm,
    handleDurRemove,
    handleRepeatConfirm,
    handleRepeatRemove,
    handlePriority,
  }
}
