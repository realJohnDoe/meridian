import { useState, useEffect } from 'react'
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

  const handleOpenDlg = (id: string) => setActiveDialog(id)
  const handleOpenRepeatDlg = (_itemType?: string) => setActiveDialog('dlgRepeat')
  const closeDialog = () => setActiveDialog(null)

  const handleDateConfirm = (dateStr: string) => {
    updateEntry({ ...entry, scheduled: { date: dateStr, time: entry.scheduled?.time || '' } })
    setActiveDialog(null)
  }

  const handleDateRemove = () => {
    updateEntry({ ...entry, scheduled: null, duration: '' })
    setActiveDialog(null)
  }

  const handleTimeConfirm = (hhmm: string) => {
    if (!entry.scheduled) return
    updateEntry({ ...entry, scheduled: { ...entry.scheduled, time: hhmm } })
  }

  const handleTimeRemove = () => {
    if (!entry.scheduled) return
    updateEntry({ ...entry, scheduled: { ...entry.scheduled, time: '' } })
  }

  const handleDurConfirm = (dur: string) => {
    updateEntry({ ...entry, duration: dur })
  }

  const handleDurRemove = () => {
    updateEntry({ ...entry, duration: '' })
  }

  const handleRepeatConfirm = (repeat: EntryState['repeat']) => {
    updateEntry({ ...entry, repeat })
    setActiveDialog(null)
  }

  const handleRepeatRemove = () => {
    updateEntry({ ...entry, repeat: null })
    setActiveDialog(null)
  }

  const handlePriority = (p: Priority | null) => {
    updateEntry({ ...entry, priority: p })
    setActiveDialog(null)
  }

  const handleSeriesClose = () => setSeriesSheetConfig(null)
  const handleDeleteClose = () => setPendingDelete(null)

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
