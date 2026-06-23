import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '@/store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from './save'
import { notify } from '@/storeBridge'
import type { SeriesSheetConfig } from './save'
import type { Occurrence, EditScope, Priority } from '@/types'
import { fmtISO } from '@/model/dateUtils'
import { newEntryRoute } from '@/routes/-entryRoute'
import { resolveWikilink } from '@/wikilinks'
import { type EntryState, ENTRY_DEFAULT } from './state'

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

  const scheduleAutoSave = useCallback((body: string) => {
    if (!entry.item) return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      saveNode(entry.item!, entry.editScope, { ...entry, body })
      autosaveTimerRef.current = null
    }, 1500)
  }, [entry])

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
    if (result === 'missing-date') notify('Please set a date for the new occurrence.')
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
    handleOpenWikilink,
    handleSave,
    handleDelete,
    handleClose,
    handleScopeChange,
    handleOpenDlg,
    handleOpenRepeatDlg,
    dialogHandlers,
    scheduleAutoSave,
  }
}
