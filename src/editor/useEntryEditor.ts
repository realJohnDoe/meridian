import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '@/store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from './save'
import type { SeriesSheetConfig } from './save'
import type { Occurrence, EditScope, Priority } from '@/types'
import { fmtISO } from '@/model'
import { useToday } from '@/hooks'
import { newEntryRoute } from '@/routes'
import { resolveWikilink } from '@/wikilinks'
import { type EntryState, type ItemType, ENTRY_DEFAULT } from './state'

export interface DialogHandlers {
  activeDialog: string | null
  pendingDelete: { title: string; onConfirm: () => void } | null
  seriesSheetConfig: SeriesSheetConfig | null
  onClose: () => void
  onDateConfirm: (dateStr: string) => void
  onDateRemove: () => void
  onPriority: (p: Priority | null) => void
  onTimeConfirm: (hhmm: string) => void
  onTimeRemove: () => void
  onDurConfirm: (dur: string) => void
  onDurRemove: () => void
  onRepeatConfirm: (repeat: EntryState['repeat']) => void
  onRepeatRemove: () => void
  onSeriesClose: () => void
  onDeleteClose: () => void
}

function entryFromItem(item: Occurrence | null, editScope: EditScope): EntryState {
  if (!item) {
    const t = new Date(); t.setHours(0, 0, 0, 0)
    return { ...ENTRY_DEFAULT, editScope, scheduled: { date: fmtISO(t), time: '' } }
  }
  return entryFromOccurrence(item, editScope)
}

export function useEntryEditor(initialOcc: Occurrence | null, initialScope: EditScope = 'single', initialTitle?: string) {
  const defaultParticipants = useStore.getState().defaultParticipants
  const today = useToday()

  const [entry, setEntry] = useState<EntryState>(() => {
    const base = entryFromItem(initialOcc, initialScope)
    const seeded = (!initialOcc && defaultParticipants.length > 0)
      ? { ...base, participants: [...defaultParticipants] }
      : base
    return initialTitle ? { ...seeded, title: initialTitle } : seeded
  })
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void } | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Populated by EntryEditor once CodeMirror mounts; used by saveMeta to capture current body
  const getBodyRef = useRef<() => string>(() => '')
  // Always points to the latest entry so timer callbacks don't close over stale state
  const entryRef = useRef(entry)
  entryRef.current = entry

  function saveMeta(next: EntryState) {
    if (!next.item || next.editScope === 'add') return
    saveNode(next.item, next.editScope, { ...next, body: getBodyRef.current() })
  }

  const scheduleAutoSave = useCallback((body: string) => {
    if (!entryRef.current.item) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      const e = entryRef.current
      saveNode(e.item!, e.editScope, { ...e, body })
      autosaveTimerRef.current = null
    }, 1500)
  }, [])

  const storeRoots = useStore(s => s.roots)
  const navigate = useNavigate()
  const router = useRouter()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveDialog(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleOpenWikilink = useCallback((ref: string) => {
    const fileSlug = resolveWikilink(ref, storeRoots)
    if (!fileSlug) {
      navigate(newEntryRoute(ref))
      return
    }
    navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, editor: fileSlug, etitle: undefined, edate: undefined, escope: undefined }) })
  }, [storeRoots, navigate])

  const handleSave = useCallback((body: string) => {
    const result = saveNode(entry.item, entry.editScope, { ...entry, body })
    if (result === 'saved') router.history.back()
  }, [entry, router])

  const handleDelete = useCallback(() => {
    deleteNode(
      entry.item,
      () => router.history.back(),
      (config) => setSeriesSheetConfig(config),
      () => setSeriesSheetConfig(null),
      (title, onConfirm) => setPendingDelete({ title, onConfirm }),
    )
  }, [entry.item, router])

  const handleClose = useCallback(() => router.history.back(), [router])

  const handleScopeChange = useCallback((scope: EditScope) => {
    if (!entry.item) return
    const { scheduled, repeat } = applyScope(entry.item, scope)
    const next = { ...entry, editScope: scope, scheduled, repeat }
    setEntry(next)
    saveMeta(next)
  }, [entry])

  const handleTypeChange = useCallback((t: ItemType) => {
    const next: EntryState = {
      ...entry,
      itemType: t,
      tracked: t === 'task',
      priority: t !== 'task' ? null : entry.priority,
      scheduled:
        t === 'note'                         ? null
        : t === 'event' && !entry.scheduled  ? { date: fmtISO(today), time: '' }
        : entry.scheduled,
    }
    setEntry(next)
    saveMeta(next)
  }, [entry, today])

  const handleDoneToggle = useCallback(() => {
    const next = { ...entry, done: !entry.done }
    setEntry(next)
    saveMeta(next)
  }, [entry])

  const handleOpenDlg = useCallback((id: string) => setActiveDialog(id), [])
  const handleOpenRepeatDlg = useCallback((_itemType?: string) => setActiveDialog('dlgRepeat'), [])
  const closeDialog = useCallback(() => setActiveDialog(null), [])

  const handleDateConfirm = useCallback((dateStr: string) => {
    const next = { ...entry, scheduled: { date: dateStr, time: entry.scheduled?.time || '' } }
    setEntry(next)
    setActiveDialog(null)
    saveMeta(next)
  }, [entry])

  const handleDateRemove = useCallback(() => {
    const next = { ...entry, scheduled: null, duration: '' }
    setEntry(next)
    setActiveDialog(null)
    saveMeta(next)
  }, [entry])

  const handleTimeConfirm = useCallback((hhmm: string) => {
    if (!entry.scheduled) return
    const next = { ...entry, scheduled: { ...entry.scheduled, time: hhmm } }
    setEntry(next)
    saveMeta(next)
  }, [entry])

  const handleTimeRemove = useCallback(() => {
    if (!entry.scheduled) return
    const next = { ...entry, scheduled: { ...entry.scheduled, time: '' } }
    setEntry(next)
    saveMeta(next)
  }, [entry])

  const handleDurConfirm = useCallback((dur: string) => {
    const next = { ...entry, duration: dur }
    setEntry(next)
    saveMeta(next)
  }, [entry])

  const handleDurRemove = useCallback(() => {
    const next = { ...entry, duration: '' }
    setEntry(next)
    saveMeta(next)
  }, [entry])

  const handleRepeatConfirm = useCallback((repeat: EntryState['repeat']) => {
    const next = { ...entry, repeat }
    setEntry(next)
    setActiveDialog(null)
    saveMeta(next)
  }, [entry])

  const handleRepeatRemove = useCallback(() => {
    const next = { ...entry, repeat: null }
    setEntry(next)
    setActiveDialog(null)
    saveMeta(next)
  }, [entry])

  const handlePriority = useCallback((p: Priority | null) => {
    const next = { ...entry, priority: p }
    setEntry(next)
    setActiveDialog(null)
    saveMeta(next)
  }, [entry])

  const handleSeriesClose = useCallback(() => setSeriesSheetConfig(null), [])
  const handleDeleteClose = useCallback(() => setPendingDelete(null), [])

  const dialogHandlers: DialogHandlers = {
    activeDialog,
    pendingDelete,
    seriesSheetConfig,
    onClose: closeDialog,
    onDateConfirm: handleDateConfirm,
    onDateRemove: handleDateRemove,
    onPriority: handlePriority,
    onTimeConfirm: handleTimeConfirm,
    onTimeRemove: handleTimeRemove,
    onDurConfirm: handleDurConfirm,
    onDurRemove: handleDurRemove,
    onRepeatConfirm: handleRepeatConfirm,
    onRepeatRemove: handleRepeatRemove,
    onSeriesClose: handleSeriesClose,
    onDeleteClose: handleDeleteClose,
  }

  return {
    entry, setEntry,
    getBodyRef,
    saveMeta,
    handleOpenWikilink,
    handleSave,
    handleDelete,
    handleClose,
    handleScopeChange,
    handleTypeChange,
    handleDoneToggle,
    handleOpenDlg,
    handleOpenRepeatDlg,
    dialogHandlers,
    scheduleAutoSave,
  }
}
