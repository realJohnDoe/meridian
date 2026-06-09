import { createFileRoute } from '@tanstack/react-router'
import { useStore } from '../store'
import { useEntryEditor } from '../hooks/useEntryEditor'
import { toggleOccDone } from '../mutations'
import EntryEditor from '../components/EntryEditor'
import DialogStack from '../components/DialogStack'

export const Route = createFileRoute('/entry/new')({
  component: NewEntryPage,
  validateSearch: (search: Record<string, unknown>): { title?: string } => ({
    title: typeof search.title === 'string' ? search.title : undefined,
  }),
})

function NewEntryPage() {
  const { title } = Route.useSearch()
  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const {
    entry, setEntry,
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
  } = useEntryEditor(null, 'all')

  // Apply prefill title after initial mount
  const entryWithTitle = title && !entry.title ? { ...entry, title } : entry

  return (
    <section className="view active">
      <EntryEditor
        entry={entryWithTitle}
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
        entry={entryWithTitle}
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
