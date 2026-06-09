import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useStore } from '../store'
import { useEntryEditor } from '../hooks/useEntryEditor'
import { expandRange } from '../model/expansion'
import { fileOccurrenceMap } from '../presentation'
import { toggleOccDone } from '../mutations'
import EntryEditor from '../components/EntryEditor'
import DialogStack from '../components/DialogStack'
import type { Occurrence } from '../types'

export const Route = createFileRoute('/entry/$fileSlug')({
  component: EntryPage,
  validateSearch: (search: Record<string, unknown>): { date?: string; scope?: string } => ({
    date:  typeof search.date  === 'string' ? search.date  : undefined,
    scope: typeof search.scope === 'string' ? search.scope : undefined,
  }),
})

function EntryPage() {
  const { fileSlug } = Route.useParams()
  const { date, scope = 'single' } = Route.useSearch()

  const items = useStore(s => s.items)
  const roots = useStore(s => s.roots)

  const occ = useMemo((): Occurrence | null => {
    if (date) {
      const d = new Date(date + 'T00:00:00')
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const found = expandRange(items, roots, d, next).find(o => o.fileSlug === fileSlug)
      if (found) return found
    }
    return fileOccurrenceMap(items, roots).get(fileSlug) ?? null
  }, [items, roots, fileSlug, date])

  // Re-mount the editor (and its local state) when navigating between entries.
  return <EditorView key={`${fileSlug}-${date ?? ''}`} occ={occ} scope={scope} />
}

function EditorView({ occ, scope }: { occ: Occurrence | null; scope: string }) {
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
  } = useEntryEditor(occ, scope)

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
