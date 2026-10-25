import { useState } from 'react'
import { overridesLostTo } from '@/model'
import { getSnapshot } from '@/storeBridge'
import { editFieldsOf } from './edits'
import type { SeriesSheetConfig } from './save'
import type { Priority } from '@/types'
import type { EntryState } from './state'

export interface DialogHandlers {
  activeDialog: string | null
  pendingDelete: { title: string; onConfirm: () => void; onArchive: () => void } | null
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
  /** A repeat change waiting on the user because it would delete `lost` changed
   *  occurrences — removing the rule, or changing it (or the start it follows)
   *  so they fall on days it no longer has. Null while nothing is pending. */
  pendingLoss: PendingLoss | null
  onLossClose: () => void
  onSeriesClose: () => void
  onDeleteClose: () => void
}

export interface PendingLoss { title: string; lost: number; kind: 'remove' | 'change'; onConfirm: () => void }

export function useEntryDialogs(entry: EntryState, updateEntry: (next: EntryState) => void) {
  const [activeDialog, setActiveDialog] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<{ title: string; onConfirm: () => void; onArchive: () => void } | null>(null)
  const [pendingLoss, setPendingLoss] = useState<PendingLoss | null>(null)
  const [seriesSheetConfig, setSeriesSheetConfig] = useState<SeriesSheetConfig | null>(null)

  // No document-level Escape listener here on purpose. Every dialog in
  // DialogStack is a Radix Dialog/AlertDialog or a vaul Drawer, each of which
  // already dismisses itself on Escape and reports it through onOpenChange.
  // A global listener additionally fired for *nested* layers (RepeatDialog's
  // end-date picker, or any Select inside a dialog), tearing down the whole
  // stack when Escape should only have closed the topmost one.

  const handleOpenDlg = (id: string) => setActiveDialog(id)
  const handleOpenRepeatDlg = (_itemType?: string) => setActiveDialog('dlgRepeat')
  const closeDialog = () => setActiveDialog(null)

  /**
   * Save `next`, asking first when that deletes changed occurrences.
   *
   * A changed occurrence belongs to a day of its series, so a save that takes
   * the day away takes the change with it: removing the rule takes them all,
   * and changing the rule or the start it follows takes the ones on days the
   * new series no longer has (see `overridesLostTo`). That is a deletion the
   * user cannot undo, so it is asked about — but only when there is something
   * to lose. A series nobody has customised (the common case) just saves.
   */
  const saveAskingFirst = (next: EntryState, kind: PendingLoss['kind']) => {
    const lost = entry.item ? overridesLostTo(getSnapshot(), entry.item, next.editScope, editFieldsOf(next)).length : 0
    if (lost === 0) { updateEntry(next); return }
    setPendingLoss({ title: entry.title, lost, kind, onConfirm: () => { updateEntry(next) } })
  }

  const handleDateConfirm = (dateStr: string) => {
    setActiveDialog(null)
    saveAskingFirst({ ...entry, scheduled: { date: dateStr, time: entry.scheduled?.time || '' } }, 'change')
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

  /**
   * Adding a repeat to a single, non-recurring occurrence converts it into a
   * series (see `applySingle`/`applyFieldsToItem` in model/storeOps.ts) — so
   * "this occurrence" is no longer what the form is showing. Switch to 'all'
   * ("Edit repeat pattern") along with the save, rather than leaving the
   * scope selector pointed at a question the save just answered differently.
   */
  const handleRepeatConfirm = (repeat: EntryState['repeat']) => {
    const becomingSeries = entry.editScope === 'single' && !entry.item?.ownerId
    setActiveDialog(null)
    saveAskingFirst({ ...entry, repeat, editScope: becomingSeries ? 'all' : entry.editScope }, 'change')
  }

  /** Stop this entry repeating — its changed occurrences go with the rule. */
  const handleRepeatRemove = () => {
    setActiveDialog(null)
    saveAskingFirst({ ...entry, repeat: null }, 'remove')
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
    pendingLoss,
    onLossClose: () => { setPendingLoss(null) },
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
