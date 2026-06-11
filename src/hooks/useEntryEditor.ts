import { useState, useCallback, useEffect } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '../store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from '../mutations'
import { notify } from '../storeBridge'
import type { SeriesSheetConfig } from '../mutations'
import type { Occurrence, EditScope } from '../types'
import { buildBodyHtml } from '../presentation'
import { fmtISO } from '../model/expansion'
import { TODAY } from '../constants'
import { resolveWikilink } from '../wikilinks'
import { type EntryState, ENTRY_DEFAULT } from '../components/EntryEditor'
import type { Priority } from '../types'

function entryFromItem(item: Occurrence | null, editScope: EditScope): EntryState {
  if (!item) {
    return { ...ENTRY_DEFAULT, editScope, scheduled: { date: fmtISO(TODAY), time: '' } }
  }
  return entryFromOccurrence(item, editScope, buildBodyHtml)
}

export function useEntryEditor(initialOcc: Occurrence | null, initialScope: EditScope = 'single', initialTitle?: string) {
  const [entry, setEntry] = useState<EntryState>(() => {
    const base = entryFromItem(initialOcc, initialScope)
    return initialTitle ? { ...base, title: initialTitle } : base
  })
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void } | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

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
      navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, editor: 'new', etitle: ref, edate: undefined, escope: undefined }) })
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

  return {
    entry, setEntry,
    activeDialog,
    pendingDelete, setPendingDelete,
    seriesSheetConfig, setSeriesSheetConfig,
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
