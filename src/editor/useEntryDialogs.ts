import { useState, useCallback, useEffect } from 'react'
import type { SeriesSheetConfig } from './save'
import type { Priority } from '@/types'
import type { EntryState } from './state'

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

export function useEntryDialogs(entry: EntryState, updateEntry: (next: EntryState) => void) {
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void } | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActiveDialog(null) }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const handleOpenDlg = useCallback((id: string) => setActiveDialog(id), [])
  const handleOpenRepeatDlg = useCallback((_itemType?: string) => setActiveDialog('dlgRepeat'), [])
  const closeDialog = useCallback(() => setActiveDialog(null), [])

  const handleDateConfirm = useCallback((dateStr: string) => {
    updateEntry({ ...entry, scheduled: { date: dateStr, time: entry.scheduled?.time || '' } })
    setActiveDialog(null)
  }, [entry, updateEntry])

  const handleDateRemove = useCallback(() => {
    updateEntry({ ...entry, scheduled: null, duration: '' })
    setActiveDialog(null)
  }, [entry, updateEntry])

  const handleTimeConfirm = useCallback((hhmm: string) => {
    if (!entry.scheduled) return
    updateEntry({ ...entry, scheduled: { ...entry.scheduled, time: hhmm } })
  }, [entry, updateEntry])

  const handleTimeRemove = useCallback(() => {
    if (!entry.scheduled) return
    updateEntry({ ...entry, scheduled: { ...entry.scheduled, time: '' } })
  }, [entry, updateEntry])

  const handleDurConfirm = useCallback((dur: string) => {
    updateEntry({ ...entry, duration: dur })
  }, [entry, updateEntry])

  const handleDurRemove = useCallback(() => {
    updateEntry({ ...entry, duration: '' })
  }, [entry, updateEntry])

  const handleRepeatConfirm = useCallback((repeat: EntryState['repeat']) => {
    updateEntry({ ...entry, repeat })
    setActiveDialog(null)
  }, [entry, updateEntry])

  const handleRepeatRemove = useCallback(() => {
    updateEntry({ ...entry, repeat: null })
    setActiveDialog(null)
  }, [entry, updateEntry])

  const handlePriority = useCallback((p: Priority | null) => {
    updateEntry({ ...entry, priority: p })
    setActiveDialog(null)
  }, [entry, updateEntry])

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
    dialogHandlers,
    handleOpenDlg,
    handleOpenRepeatDlg,
    setSeriesSheetConfig,
    setPendingDelete,
  }
}
