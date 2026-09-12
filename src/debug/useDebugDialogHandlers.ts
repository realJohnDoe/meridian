import { useState } from 'react'
import type { DialogHandlers, EntryState } from '@/editor'

// ── Dialog state hook ─────────────────────────────────────────────────────────
//
// Manages the activeDialog open/close state and assembles the DialogHandlers
// object EntryEditor's dialog stack expects, keeping this glue out of the main
// component.

export function useDebugDialogHandlers(
  setEntry: React.Dispatch<React.SetStateAction<EntryState | null>>,
) {
  const [activeDialog, setActiveDialog] = useState<string | null>(null)

  const handlers: DialogHandlers = {
    activeDialog,
    pendingDelete:    null,
    seriesSheetConfig: null,
    onClose:       () => setActiveDialog(null),
    onDateConfirm: date => { setEntry(e => e ? { ...e, scheduled: { date, time: e.scheduled?.time || '' } } : e); setActiveDialog(null) },
    onDateRemove:  ()   => { setEntry(e => e ? { ...e, scheduled: null, duration: '' } : e); setActiveDialog(null) },
    onPriority:    p    => { setEntry(e => e ? { ...e, priority: p } : e); setActiveDialog(null) },
    onTimeConfirm: time => { setEntry(e => e?.scheduled ? { ...e, scheduled: { ...e.scheduled, time } } : e) },
    onTimeRemove:  ()   => { setEntry(e => e?.scheduled ? { ...e, scheduled: { ...e.scheduled, time: '' } } : e) },
    onDurConfirm:  dur  => { setEntry(e => e ? { ...e, duration: dur } : e) },
    onDurRemove:   ()   => { setEntry(e => e ? { ...e, duration: '' } : e) },
    onRepeatConfirm: r  => { setEntry(e => e ? { ...e, repeat: r } : e); setActiveDialog(null) },
    onRepeatRemove: ()  => { setEntry(e => e ? { ...e, repeat: null } : e); setActiveDialog(null) },
    onSeriesClose: () => {},
    onDeleteClose: () => {},
  }

  const openDialog      = (id: string) => setActiveDialog(id)
  const openRepeatDialog = () => setActiveDialog('dlgRepeat')

  return { handlers, openDialog, openRepeatDialog }
}
