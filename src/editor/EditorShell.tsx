import type { useEntryEditor } from './useEntryEditor'
import type { EntryState } from './state'
import type { StoreItem, Roots } from '@/types'
import EntryEditor from './EntryEditor'
import DialogStack from './DialogStack'
import { toggleOccDone } from '@/occurrenceActions'

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
    flushPendingLinksRef,
    saveMeta,
    handleOpenWikilink,
    handleSave, handleScopeChange,
    handleTypeChange, handleDoneToggle,
    handleOpenDlg, handleOpenRepeatDlg,
    dialogHandlers,
    scheduleAutoSave,
    titleMissing,
    focusTitleTick,
  } = hooks

  return (
    <section className="view active flex-1 min-h-0 flex flex-col">
      <EntryEditor
        entry={entry}
        onChange={setEntry}
        onSave={handleSave}
        onAutoSave={scheduleAutoSave}
        onMetaSave={saveMeta}
        getBodyRef={getBodyRef}
        flushPendingLinksRef={flushPendingLinksRef}
        onOpenDlg={handleOpenDlg}
        onOpenRepeatDlg={handleOpenRepeatDlg}
        onScopeChange={handleScopeChange}
        onTypeChange={handleTypeChange}
        onDoneToggle={handleDoneToggle}
        items={items}
        roots={roots}
        onOpenWikilink={handleOpenWikilink}
        onToggleDoneBacklink={toggleOccDone}
        titleError={titleMissing}
        focusTitleTick={focusTitleTick}
      />
      <DialogStack entry={entry} handlers={dialogHandlers} />
    </section>
  )
}
