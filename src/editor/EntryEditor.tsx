import { useEffect, useRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { Calendar, Clock, Timer, Flag, Repeat, CheckSquare, CalendarDays, FileText, Info } from 'lucide-react'
import type { Occurrence, StoreItem, Roots, EditScope } from '@/types'
import type { SeriesContext } from '@/model'
import DialogStack from './DialogStack'
import MoveVaultDialog from './dialogs/MoveVaultDialog'
import type { PendingMove } from './dialogs/MoveVaultDialog'
import type { DialogHandlers } from './useEntryDialogs'
import { badgeVariants } from '@/components/ui/badge'
import { PRIORITY_CLASS } from '@/components/primitives/occurrence-variants'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { segmentedGroupVariants, segmentedItemVariants } from './segmentedGroup'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import ListedOnRow from './ListedOnRow'
import ItemsList from './ItemsList'
import ParticipantsRow from './ParticipantsRow'
import EntryBody from './EntryBody'
import { cn } from '@/lib/cn'
import type { EntryState, ItemType } from './state'
import type { LucideIcon } from 'lucide-react'
import { formatDurationChip, fmtDuration, fmtShort } from '@/format'
import { fmtT, parseDateString } from '@/model'
import { useStore } from '@/store'
import type { PendingLinks } from './usePendingLinks'
import { useAllParticipants } from '@/hooks'
import { VaultChip } from '@/components'

function PropChip({ icon: Icon, label, value, pressed, onClick, className }: {
  icon: LucideIcon
  label: string
  value?: string
  pressed: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button className={cn(badgeVariants({ variant: 'chip' }), className)} aria-pressed={pressed} onClick={onClick}>
      <Icon size={13} />{label}
      {value && <span className="text-2xs font-mono opacity-80 ml-px">{value}</span>}
    </button>
  )
}


const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
const TYPE_CHIP_ACTIVE_CLS: Record<string, string> = {
  task:  'data-[state=on]:text-task',
  event: 'data-[state=on]:text-event',
  note:  'data-[state=on]:text-note',
}


/**
 * What the editor needs from its controller. `useEntryEditor`'s return value
 * satisfies this structurally, so a route hands its `hooks` straight through as
 * one prop — no per-field forwarding layer in between.
 *
 * Declared as its own interface rather than `ReturnType<typeof useEntryEditor>`
 * so `debug/NodeInheritanceDebugger` can drive the same component from a
 * hand-built object: it edits a scratch snapshot, never the vault, so it has no
 * autosave, no wikilink navigation and no backlink toggling. Everything optional
 * here is a capability that caller legitimately doesn't have.
 */
export interface EntryEditorHooks {
  entry: EntryState
  /** How this occurrence sits in its series — derived in model/, see seriesContext. */
  series: SeriesContext
  /** The vault this entry lives in (or would, for a new one). Scopes links and the file picker. */
  vaultId: string | null
  /**
   * What the vault chip does when a vault is picked: retarget a brand-new entry
   * before its first save, or — once the file exists — stage a move for
   * confirmation. Null when neither applies (a sandbox or subscription entry,
   * which may not move at all).
   */
  onVaultChange: ((vaultId: string) => void) | null
  /** A move the user picked but hasn't confirmed. Rendered by `MoveVaultDialog`. */
  pendingMove?: PendingMove | null
  onMoveConfirm?: () => void
  onMoveCancel?: () => void
  pendingLinks: PendingLinks
  dialogHandlers: DialogHandlers
  setEntry: (updater: (prev: EntryState) => EntryState) => void
  handleSave: (body: string) => void
  handleOpenDlg: (id: string) => void
  handleOpenRepeatDlg: (itemType: ItemType) => void
  handlePromoteTask: (title: string, done: boolean) => string | null
  scheduleAutoSave?: (body: string) => void
  saveMeta?: (next: EntryState) => void
  handleScopeChange?: (scope: EditScope) => void
  handleTypeChange?: (t: ItemType) => void
  handleDoneToggle?: () => void
  handleOpenWikilink?: (ref: string) => void
  handleToggleDoneBacklink?: (occ: Occurrence) => void
  titleMissing?: boolean
  focusTitleTick?: number
}

interface Props {
  hooks: EntryEditorHooks
  items: StoreItem[]
  roots: Roots
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

export default function EntryEditor({ hooks, items, roots }: Props) {
  const {
    entry, series, vaultId, onVaultChange, pendingMove, onMoveConfirm, onMoveCancel,
    pendingLinks, dialogHandlers,
    setEntry, handleSave, handleOpenDlg, handleOpenRepeatDlg, handlePromoteTask,
    scheduleAutoSave, saveMeta, handleScopeChange, handleTypeChange, handleDoneToggle,
    handleOpenWikilink, handleToggleDoneBacklink, titleMissing, focusTitleTick,
  } = hooks
  const hour12             = useStore(s => s.localePrefs.hour12)
  const backlinks          = useStore(s => s.backlinks)
  // Per vault, and named: with several vaults registered, "changes aren't
  // saved" has to say *which* vault it is talking about. Retires the hardcoded
  // "Tutorial vault" string — the Tutorial vault is simply the read-only vault
  // most people meet first.
  const readOnlyVault      = useStore(s =>
    s.vaults.find(v => v.id === vaultId && (s.syncByVault.get(v.id)?.readOnly ?? false)))
  const titleRef  = useRef<HTMLTextAreaElement>(null)
  const viewRef   = useRef<EditorView | null>(null)

  useEffect(() => {
    if (titleRef.current) autoResize(titleRef.current)
  }, [entry.title])

  useEffect(() => {
    if (focusTitleTick) titleRef.current?.focus()
  }, [focusTitleTick])

  function changeScope(scope: EditScope) {
    setEntry(prev => ({ ...prev, editScope: scope }))
    handleScopeChange?.(scope)
  }

  const allParticipants = useAllParticipants(items)

  const { item, title, body, scheduled, duration, tracked, itemType, repeat, done, items: listItems, participants, priority, editScope } = entry

  const { effectiveKey, pendingKeys, handleAdd, handleRemove } = pendingLinks

  const linkedKeys = [...(effectiveKey ? backlinks.get(effectiveKey) ?? [] : []), ...pendingKeys]

  const { isRecurring, isScheduled, isAfterCompletion } = series
  const hasSched = !!item?.date

  const hasDate = !!scheduled
  const hasTime = !!(scheduled?.time)
  const isSingleScope = editScope === 'single'
  const isNote = itemType === 'note'

  const showDateChip = !isNote
  const showRepeat = !isNote && (hasDate || tracked) && (!isSingleScope || !isRecurring)
  const bodyKey = item ? `${item.entryKey || 'item'}-${item.date || ''}-${editScope}` : 'new'

  const showScopeRow = isRecurring || hasSched

  return (
    <section className="flex-1 min-h-0 flex flex-col">
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]"><div className="px-3.5 pt-4.5 pb-30 lg:max-w-3xl lg:mx-auto">

        {readOnlyVault && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 mb-3 text-xs text-muted-foreground">
            <Info size={14} className="shrink-0" />
            {readOnlyVault.name} is read-only — changes aren&rsquo;t saved.
          </div>
        )}

        {/* ── FILE-LEVEL: title + slug ── */}
        <div className="flex items-start gap-2.5 mb-3">
          {tracked && (
            <Checkbox
              checked={done}
              onCheckedChange={() => handleDoneToggle?.()}
              className="mt-1"
              visualClassName="size-6"
            />
          )}
          <div className="flex-1 min-w-0">
            <textarea
              ref={titleRef}
              className={cn(
                'w-full text-2xl font-light text-foreground bg-transparent border-none outline-none leading-snug resize-none',
                titleMissing ? 'placeholder:text-destructive' : 'placeholder:text-muted-foreground',
              )}
              placeholder="Title"
              rows={1}
              value={title}
              onChange={e => {
                setEntry(prev => ({ ...prev, title: e.target.value }))
                autoResize(e.target)
                if (editScope !== 'add') scheduleAutoSave?.(viewRef.current?.state.doc.toString().trimEnd() ?? '')
              }}
            />
            <div className="flex items-center gap-2 mt-0.5 min-w-0">
              {item && (
                <p className="font-mono text-2xs text-muted-foreground truncate">{item.metadata.fileSlug}.md</p>
              )}
              {/* On a brand-new entry this is a picker over where the file will
                  be created. On an existing one it is the move control — same
                  chip, but picking a vault opens the confirm dialog below
                  rather than silently re-targeting. */}
              <VaultChip vaultId={vaultId} onChange={onVaultChange} />
            </div>
          </div>
        </div>

        {/* ── FILE-LEVEL: listed-on reverse chips ── */}
        <ListedOnRow
          linkedKeys={linkedKeys}
          entryKey={effectiveKey}
          vaultId={vaultId}
          roots={roots}
          onOpenWikilink={handleOpenWikilink}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />

        {/* ── OCCURRENCE-LEVEL: scope caption → type → metadata → participants ── */}
        <Card className="mt-3 mb-4 overflow-hidden bg-card shadow-(--shadow-card)">
          <CardContent className="px-3 pt-3 pb-3 bg-card">
            {showScopeRow && (
              <Select value={editScope} onValueChange={v => changeScope(v as EditScope)}>
                <SelectTrigger
                  className={cn(
                    'w-fit gap-1 !h-11 -mt-3.5 -mb-0.5 px-0 text-xs font-medium text-muted-foreground',
                    'border-0 shadow-none bg-transparent rounded-none',
                    'hover:text-foreground focus:ring-0 focus-visible:ring-1 focus-visible:ring-ring focus-visible:rounded-sm',
                    '[&>svg]:ml-1 [&>svg]:shrink-0 [&>svg]:size-3 [&>svg]:opacity-70',
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add new occurrence</SelectItem>
                  <SelectItem value="single">Edit this occurrence</SelectItem>
                  {isScheduled && <SelectItem value="future">Edit this and all following occurrences</SelectItem>}
                  {(isScheduled || isAfterCompletion) && <SelectItem value="all">Edit repeat pattern</SelectItem>}
                </SelectContent>
              </Select>
            )}
            <ToggleGroup
              type="single"
              value={itemType}
              onValueChange={(v) => { if (v) handleTypeChange?.(v as ItemType) }}
              className={cn(segmentedGroupVariants(), 'mb-4')}
            >
              {(['task', 'event', 'note'] as ItemType[]).map(t => (
                <ToggleGroupItem
                  key={t}
                  value={t}
                  className={cn(segmentedItemVariants(), 'capitalize', TYPE_CHIP_ACTIVE_CLS[t])}
                >
                  {t === 'task' && <CheckSquare size={13} />}
                  {t === 'event' && <CalendarDays size={13} />}
                  {t === 'note' && <FileText size={13} />}
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            {(showDateChip || tracked || showRepeat) && (
              <div className="flex gap-1.5 flex-wrap mb-4">
                {showDateChip && (
                  <PropChip icon={Calendar} label="Date" pressed={!!scheduled} onClick={() => handleOpenDlg('dlgSched')}
                    value={scheduled ? (fmtShort(parseDateString(scheduled.date) ?? new Date(scheduled.date))) : undefined} />
                )}
                {showDateChip && hasDate && (
                  <PropChip icon={Clock} label="Time" pressed={hasTime} onClick={() => handleOpenDlg('dlgTime')}
                    value={hasTime ? (fmtT(scheduled.time, hour12) ?? undefined) : undefined} />
                )}
                {showDateChip && (
                  <PropChip icon={Timer} label="Duration" pressed={!!duration} onClick={() => handleOpenDlg('dlgDur')}
                    value={duration ? (scheduled ? formatDurationChip(duration, scheduled, hour12) : fmtDuration(duration)) : undefined} />
                )}
                {tracked && (
                  <PropChip icon={Flag} label="Priority" pressed={!!priority} onClick={() => handleOpenDlg('dlgPriority')}
                    value={priority ? PRIORITY_LABELS[priority] : undefined}
                    className={priority ? PRIORITY_CLASS[priority] : undefined} />
                )}
                {showRepeat && (
                  <PropChip icon={Repeat} label="Repeat" pressed={!!repeat} onClick={() => handleOpenRepeatDlg(itemType)}
                    value={repeat ? (repeat.type === 'after_completion' ? 'after ✓' : repeat.type) : undefined} />
                )}
              </div>
            )}

            <ParticipantsRow participants={participants} onChange={ps => {
              const next = { ...entry, participants: ps }
              setEntry(() => next)
              saveMeta?.(next)
            }} allParticipants={allParticipants} />

            {editScope === 'add' && (
              <div className="mt-3 flex justify-end">
                <Button variant="default" size="sm" onClick={() => handleSave(viewRef.current?.state.doc.toString().trimEnd() ?? '')}>
                  Save occurrence
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <EntryBody key={bodyKey} body={body} viewRef={viewRef} roots={roots} vaultId={vaultId} items={items} onOpenWikilink={handleOpenWikilink} onChange={editScope !== 'add' ? scheduleAutoSave : undefined} readOnly={!!readOnlyVault} />

        <ItemsList
          items={listItems}
          onChange={its => {
            const next = { ...entry, items: its }
            setEntry(() => next)
            saveMeta?.(next)
          }}
          roots={roots}
          currentKey={effectiveKey ?? null}
          vaultId={vaultId}
          onPromote={handlePromoteTask}
          onOpenWikilink={handleOpenWikilink}
          onToggleDone={handleToggleDoneBacklink}
        />

      </div></div>

      {/* The dialogs the property chips above open — same controller, so they
          live with the chips rather than behind another wrapper component. */}
      <DialogStack entry={entry} handlers={dialogHandlers} />

      {/* The vault chip's own dialog. Outside DialogStack, which is the
          entry-fields stack: a move edits no field, it relocates the file. */}
      <MoveVaultDialog
        move={pendingMove ?? null}
        onConfirm={() => onMoveConfirm?.()}
        onClose={() => onMoveCancel?.()}
      />
    </section>
  )
}
