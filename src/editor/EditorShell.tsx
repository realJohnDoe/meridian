/**
 * Shared render shell for entry editor pages (existing entry + new entry).
 * Receives the entry to display (may differ from hooks.entry when a title is
 * pre-filled) and the full return value of useEntryEditor.
 */
import type { useEntryEditor } from './useEntryEditor'
import type { EntryState } from './state'
import type { StoreItem, Roots } from '@/types'
import EntryEditor from './EntryEditor'
import DialogStack from './DialogStack'
import { toggleOccDone } from '@/occurrenceActions'
import { useStore } from '@/store'

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
    getBodyRef,
    saveMeta,
    handleOpenWikilink,
    handleSave, handleDelete, handleClose, handleScopeChange,
    handleTypeChange, handleDoneToggle,
    handleOpenDlg, handleOpenRepeatDlg,
    dialogHandlers,
    scheduleAutoSave,
  } = hooks

  const favorites       = useStore(s => s.favorites)
  const toggleFavorite  = useStore(s => s.toggleFavorite)
  const fileSlug        = entry.item?.fileSlug
  const isFavorited     = fileSlug ? favorites.includes(fileSlug) : false

  return (
    <section className="view active flex-1 min-h-0 flex flex-col">
      <EntryEditor
        entry={entry}
        onChange={setEntry}
        onSave={handleSave}
        onAutoSave={scheduleAutoSave}
        onMetaSave={saveMeta}
        getBodyRef={getBodyRef}
        onDelete={handleDelete}
        onClose={handleClose}
        onOpenDlg={handleOpenDlg}
        onOpenRepeatDlg={handleOpenRepeatDlg}
        onScopeChange={handleScopeChange}
        onTypeChange={handleTypeChange}
        onDoneToggle={handleDoneToggle}
        items={items}
        roots={roots}
        onOpenWikilink={handleOpenWikilink}
        onToggleDoneBacklink={toggleOccDone}
        isFavorited={isFavorited}
        onToggleFavorite={fileSlug ? () => toggleFavorite(fileSlug) : undefined}
      />
      <DialogStack entry={entry} handlers={dialogHandlers} />
    </section>
  )
}
