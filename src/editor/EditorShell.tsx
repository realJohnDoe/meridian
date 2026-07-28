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
    series,
    pendingLinks,
    saveMeta,
    handleOpenWikilink,
    handleSave, handleScopeChange,
    handleTypeChange, handleDoneToggle,
    handlePromoteTask,
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
        series={series}
        onChange={setEntry}
        onSave={handleSave}
        onAutoSave={scheduleAutoSave}
        onMetaSave={saveMeta}
        pendingLinks={pendingLinks}
        onOpenDlg={handleOpenDlg}
        onOpenRepeatDlg={handleOpenRepeatDlg}
        onScopeChange={handleScopeChange}
        onTypeChange={handleTypeChange}
        onDoneToggle={handleDoneToggle}
        onPromoteTask={handlePromoteTask}
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
