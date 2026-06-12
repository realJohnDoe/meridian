/**
 * Shared render shell for entry editor pages (existing entry + new entry).
 * Receives the entry to display (may differ from hooks.entry when a title is
 * pre-filled) and the full return value of useEntryEditor.
 */
import type { useEntryEditor } from '../hooks/useEntryEditor'
import type { EntryState } from '@/editor/state'
import type { StoreItem, Roots } from '../types'
import EntryEditor from './EntryEditor'
import DialogStack from './DialogStack'
import { toggleOccDone } from '../occurrenceActions'

type Hooks = ReturnType<typeof useEntryEditor>

interface Props {
  entry: EntryState
  hooks: Hooks
  items: StoreItem[]
  roots: Roots
}

export default function EditorShell({ entry, hooks, items, roots }: Props) {
  const {
    setEntry,
    activeDialog,
    pendingDelete, setPendingDelete,
    seriesSheetConfig, setSeriesSheetConfig,
    handleOpenWikilink,
    handleSave, handleDelete, handleClose, handleScopeChange,
    handleOpenDlg, handleOpenRepeatDlg, closeDialog,
    handleDateConfirm, handleDateRemove,
    handleTimeConfirm, handleTimeRemove,
    handleDurConfirm, handleDurRemove,
    handleRepeatConfirm, handleRepeatRemove,
    handlePriority,
  } = hooks

  return (
    <section className="view active">
      <EntryEditor
        entry={entry}
        onChange={setEntry}
        onSave={handleSave}
        onDelete={handleDelete}
        onClose={handleClose}
        onOpenDlg={handleOpenDlg}
        onOpenRepeatDlg={handleOpenRepeatDlg}
        onScopeChange={handleScopeChange}
        items={items}
        roots={roots}
        onOpenWikilink={handleOpenWikilink}
        onToggleDoneBacklink={toggleOccDone}
      />
      <DialogStack
        entry={entry}
        activeDialog={activeDialog}
        pendingDelete={pendingDelete}
        seriesSheetConfig={seriesSheetConfig}
        onClose={closeDialog}
        onDateConfirm={handleDateConfirm}
        onDateRemove={handleDateRemove}
        onPriority={handlePriority}
        onTimeConfirm={handleTimeConfirm}
        onTimeRemove={handleTimeRemove}
        onDurConfirm={handleDurConfirm}
        onDurRemove={handleDurRemove}
        onRepeatConfirm={handleRepeatConfirm}
        onRepeatRemove={handleRepeatRemove}
        onSeriesClose={() => setSeriesSheetConfig(null)}
        onDeleteClose={() => setPendingDelete(null)}
      />
    </section>
  )
}
