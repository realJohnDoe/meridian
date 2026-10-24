import { startOfToday } from 'date-fns'
import { toast } from 'sonner'
import { fmtISO, applyEdit, joinFileMeta, newEntryKey, excludeOccurrence, setArchived, deletionEndsAfterCompletionSeries, deleteByEntryKey, deleteFollowing, entryKeyItems, findSeries } from '@/model'
import { isSeries, isTracked } from '@/types'
import type { Occurrence, OccurrenceEntry, OccurrenceMetadata, Repeat, Scheduled, StoreItem, EditScope } from '@/types'
import type { EditFields } from '@/model'
import { getSnapshot, getSlugSnapshot, getEntries, getItems, getDefaultVaultId, getSandboxVaultId } from '@/storeBridge'
import { keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { commitNext, commitDelete } from '@/storeCommit'
import type { EntryState, ItemType } from './state'
import { editFieldsOf } from './edits'

// ── BACKLINK HELPERS ──────────────────────────────────────────

// `target` is an EntryKey (which file's `items:` list is edited) but `sourceSlug`
// is a BARE slug — it is written into that file as `[[sourceSlug]]`, and a file
// never carries a vault id. The two halves are deliberately different types here;
// before `EntryKey` was branded, passing one where the other belonged compiled.

/** Add `[[sourceSlug]]` to `target`'s items list if not already present. */
export function addItemLink(target: EntryKey, sourceSlug: string): void {
  const entries = getEntries()
  const entry = entries.get(target)
  if (!entry) return
  const stored = `[[${sourceSlug}]]`
  if (entry.root.items.includes(stored)) return
  const next = new Map(entries)
  next.set(target, { ...entry, root: { ...entry.root, items: [...entry.root.items, stored] } })
  commitNext({ entries: next }, [target])
}

/** Remove `[[sourceSlug]]` from `target`'s items list. */
export function removeItemLink(target: EntryKey, sourceSlug: string): void {
  const entries = getEntries()
  const entry = entries.get(target)
  if (!entry) return
  const stored = `[[${sourceSlug}]]`
  const next = new Map(entries)
  next.set(target, { ...entry, root: { ...entry.root, items: entry.root.items.filter(i => i !== stored) } })
  commitNext({ entries: next }, [target])
}

// ── SERIES-DELETE SHEET CONFIG ────────────────────────────────

type SeriesSheetOption = {
  icon: 'calendar' | 'calendar-range'
  label: string
  sublabel: string
  /** Shown as a warning banner while this option is selected. */
  warning?: string
  onClick: () => void
}
export type SeriesSheetConfig = {
  title:    string
  options:  SeriesSheetOption[]
  /**
   * Archives the whole file instead of deleting some slice of its
   * occurrences. Deliberately not a fourth `option`: the radio group above
   * answers "which occurrences", a file-level action answers a different
   * question, and giving it its own slot keeps a scope choice from ever
   * looking like a peer of a one-shot action — see `plans/archived-entries.md`
   * PR 2. Optional for the same reason `DeleteDialog`'s `onArchive` is.
   */
  onArchive?: () => void
}

// ── ENTRY EDITOR HELPERS ──────────────────────────────────────

export function applyScope(
  item:   Occurrence,
  scope:  EditScope,
  items?: StoreItem[],
): { scheduled: Scheduled | null; repeat: Repeat | null } {
  const allItems = items ?? getItems()
  // Whose series this occurrence belongs to is a question for the store, not
  // for `item`. An editor pins its occurrence for the whole session, so after
  // anything re-homes the occurrence — a 'future' save splitting the series is
  // the one that happens — `item.ownerId` names a series it has left. Reading
  // it off the live item keeps one answer: `currentFields` already derives the
  // store's side from that item, so a stale `ownerId` here made base and
  // current disagree about which series' repeat they were even describing, and
  // the next repeat edit reported a conflict with nobody.
  const live = allItems.find((i): i is OccurrenceEntry<OccurrenceMetadata> => !isSeries(i) && i.id === item.id)
  const ownerId = live?.ownerId ?? item.ownerId
  const parentSeries = ownerId
    ? (allItems.find(i => isSeries(i) && i.id === ownerId) ?? null)
    : null
  const seriesRepeat = parentSeries && isSeries(parentSeries) ? parentSeries.repeat : null
  const occDate  = item.date || null
  const occTime  = item.time || null
  const rootDate = (parentSeries && isSeries(parentSeries)) ? parentSeries.date : occDate
  const rootTime = (parentSeries && isSeries(parentSeries)) ? parentSeries.time : occTime
  if (scope === 'single') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: null }
  if (scope === 'future') return { scheduled: occDate ? { date: occDate, time: occTime || '' } : null, repeat: seriesRepeat || null }
  if (scope === 'add')    { return { scheduled: { date: fmtISO(startOfToday()), time: occTime || '' }, repeat: null } }
  return { scheduled: rootDate ? { date: rootDate, time: (rootTime as string) || '' } : null, repeat: seriesRepeat || null }
}

export function entryFromOccurrence(
  item:      Occurrence,
  editScope: EditScope,
  items?:    StoreItem[],
): EntryState {
  const m = item.metadata
  const { scheduled, repeat } = applyScope(item, editScope, items)
  const tracked  = isTracked(item)
  const itemType: ItemType = tracked ? 'task' : scheduled ? 'event' : 'note'
  return {
    item,
    title:        m.title    || '',
    body:         m.body     || '',
    scheduled,
    repeat,
    duration:     m.duration || '',
    tracked,
    itemType,
    // 'add' starts a brand-new occurrence off `item`'s other fields (title,
    // tags, ...) — but not its done state, which belongs to that occurrence,
    // not the one being created.
    done:         editScope === 'add' ? false : (m.done ?? false),
    tags:         [...m.tags],
    items:        [...m.items],
    participants: [...m.participants],
    priority:     (m.priority || null),
    editScope,
  }
}

// ── MUTATION API ──────────────────────────────────────────────

type SaveFields = EntryState & { body: string }

/** The key of the file that was written, or null when nothing was (empty title). */
export type SaveResult = EntryKey | null

/**
 * The eleven fields as the store holds them *right now* for `item`.
 *
 * Two tiers, because two things can be missing independently:
 *
 *  - The **entry** carries the file-level fields (title, body, tags, items) on
 *    its root. This tier is available whenever the file is still in the store,
 *    including for an occurrence generated from a series rather than stored.
 *  - The **stored item** carries the occurrence-level ones (participants,
 *    done, priority, duration, and the schedule `applyScope` derives). A series
 *    occurrence with no override of its own is generated by `expandRange`, so
 *    it is not in `entry.items` and this tier is simply unavailable for it.
 *
 * Whatever can't be resolved falls back to `next` — the editor's own value,
 * which is what a save would have written anyway. Degrading to the previous
 * behaviour for a field is always safe; guessing at one is not.
 *
 * Routed through `entryFromOccurrence` rather than reading the metadata by
 * hand, so `current` and `base` are derived by the same function from the same
 * shape. A second, subtly different derivation here would report fields as
 * changed that nobody touched, which is the exact failure this is removing.
 */
function currentFields(item: Occurrence, editScope: EditScope, next: EditFields): EditFields {
  const entry = getEntries().get(item.entryKey)
  if (!entry) return next

  const live = entry.items.find(i => !isSeries(i) && i.id === item.id)
  // An excluded override is a suppression stub for a slot the occurrence has
  // moved off of (see `applySingle`'s "generated occurrence moved to a
  // different date" branch, which reuses the pre-move id for exactly this
  // stub) — never the live state of the occurrence the editor is holding.
  // Reading its date/done back as "current" is what reverted an
  // after_completion occurrence's move the next time the same session saved
  // (e.g. ticking it done right after moving it): the stub's stale
  // pre-move date would win every field this save didn't itself touch.
  if (!live || isSeries(live) || live.excluded) {
    return { ...next, title: entry.root.title, body: entry.root.body ?? '', tags: [...entry.root.tags], items: [...entry.root.items] }
  }

  // A one-entry Roots map: `joinFileMeta` only ever looks up this key, and
  // building it here keeps the store's full roots map out of this path.
  const joined = joinFileMeta(item.entryKey, live.metadata, new Map([[item.entryKey, entry.root]]))
  return editFieldsOf(entryFromOccurrence({ ...live, metadata: joined }, editScope, getItems()))
}

/**
 * Widen an editor's patch into the whole field set to write.
 *
 * `edits` is what the user actually changed — recorded as they changed it, in
 * `editor/edits.ts`, rather than inferred by diffing two snapshots. Everything
 * else is taken from what the store holds *now*, so a field nobody here
 * touched keeps whatever arrived from the agenda, another tab or a sync while
 * this editor sat open.
 *
 * An editor loads its fields once and never re-reads them into CodeMirror (by
 * design — a live re-read would move the cursor), so without this a blind
 * full-entry write turns every untouched field into a regression: the
 * reschedule from another device, the checkbox ticked from the agenda, the
 * description someone else finished. On a synced vault each of those is also a
 * push, which the other device sees as a change worth pushing back — the loop
 * that turns one conflict into a run of conflict copies.
 *
 * The key set travels with the values because `applyEdit` needs it for a
 * second purpose: scoping its `extra`-bag strip to the fields this save is
 * actually rewriting, rather than every registry field regardless (data-
 * integrity survey, finding #1). A save that renamed only the title must not
 * delete an unrelated hand-authored `tags`/`done`/`priority` the model cannot
 * type. Under the patch that set is exact rather than reconstructed.
 *
 * Not applied to `add` scope: that save creates a *new* occurrence rather than
 * updating the one the editor is holding, so "what this entry looks like now"
 * is not the right base for it — `entryFromOccurrence` deliberately answers
 * with today's date and a cleared `done` for that scope.
 */
function widenEdits(
  item:      Occurrence,
  editScope: EditScope,
  next:      EditFields,
  edits:     Partial<EditFields> | undefined,
): TouchedFields {
  if (!edits || editScope === 'add') return { fields: next, touchedKeys: undefined }
  return {
    fields: { ...currentFields(item, editScope, next), ...edits },
    touchedKeys: new Set(Object.keys(edits) as Array<keyof EditFields>),
  }
}

/** `widenEdits`' result: the fields to write, plus which `EditFields` keys the
 *  save actually named — see `applyEdit`'s `touchedKeys` parameter. */
interface TouchedFields {
  fields: EditFields
  touchedKeys: ReadonlySet<keyof EditFields> | undefined
}

/** How each field is named to the user. Not derived from the key: `tracked`
 *  and `items` are terms of art here (see GLOSSARY.md) and neither reads as
 *  itself in a sentence. */
const FIELD_LABELS: Record<keyof EditFields, string> = {
  title:        'the title',
  body:         'the description',
  tags:         'the tags',
  items:        'the checklist',
  participants: 'the participants',
  tracked:      'the item type',
  done:         'the done state',
  priority:     'the priority',
  scheduled:    'the date',
  duration:     'the duration',
  repeat:       'the repeat',
}

/**
 * Tell the user that a field they were editing had also been changed
 * elsewhere, and that theirs is the version that was written.
 *
 * Which fields those are is `contestedFields`' call (`editor/edits.ts`): the
 * store has moved off the value it held when the user started editing, and not
 * to where they were taking it. The other writer is usually a second view of
 * this same vault — another tab, or the installed PWA, whose writes reach this
 * store through `startCrossTabSync` — but a sync pulling another device's
 * change produces the identical situation and deserves the identical notice.
 *
 * A warning rather than a conflict copy, unlike the backend collision this
 * mirrors: the loser here is one field rather than a whole file, and there is
 * nowhere sensible to put a timestamped copy of one. What matters is that the
 * user hears about it — the loss is otherwise completely invisible.
 *
 * With a single writer this cannot fire at all, which is not a hope but a
 * checked property: see `singleWriter.test.tsx`.
 */
export function reportContested(contested: Array<keyof EditFields>): void {
  if (contested.length === 0) return
  const labels = contested.map(f => FIELD_LABELS[f])
  const named = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)!}`
  toast.warning(`${named} also changed somewhere else — your version was kept.`, { duration: 7000 })
}

/**
 * What the store says about `item` at `editScope`, as an `EntryState`.
 *
 * The editor's whole form is this plus whatever the user has typed over it
 * (`editor/edits.ts`), which is why it has to answer from the store rather
 * than from `item`: an editor pins its occurrence for the session, so
 * `item.metadata` is a mount-time photograph and goes stale the moment the
 * agenda ticks a checkbox or a sync lands. `currentFields` is the same
 * derivation a save already used to decide what *not* to overwrite — sharing
 * it is the point, since a form and a save that disagreed about what the store
 * holds is exactly the class of bug this replaced.
 *
 * `itemType` is re-derived rather than carried over, because `tracked` and
 * `scheduled` may have come back different from the pinned occurrence's.
 */
export function storeView(item: Occurrence, editScope: EditScope, items: StoreItem[]): EntryState {
  const pinned = entryFromOccurrence(item, editScope, items)
  const fields = currentFields(item, editScope, editFieldsOf(pinned))
  const itemType: ItemType = fields.tracked ? 'task' : fields.scheduled ? 'event' : 'note'
  return { ...pinned, ...fields, itemType }
}

/** Everything `saveNode` needs beyond the item and its fields. */
export interface SaveOpts {
  /**
   * Identifies the draft when `item` is null (a brand-new entry), so a second
   * create-scoped save for the same draft upserts onto the file the first one
   * made instead of creating another — see `applyNew`.
   */
  draftId?: string
  /** Where a brand-new entry lands when the editor's vault chip picked a vault. */
  targetVaultId?: string | null
  /**
   * The fields the user actually changed, straight from the editor's own
   * record of them (`editor/edits.ts`) rather than inferred from a snapshot.
   * These are written; every other field is left at whatever the store holds
   * by the time the save lands. See `widenEdits`. Omitted for a brand-new
   * entry, which has no store row to leave anything at, and by callers with
   * no such record to offer (the debug view), which write the lot.
   */
  edits?: Partial<EditFields>
}

/**
 * Persist an editor save.
 *
 * An existing item keeps its own vault (it rides inside its key); a new one goes
 * to `opts.targetVaultId` if the editor's vault chip picked one, else to the
 * default vault, else — when there is no writable vault registered at all —
 * the Tutorial's own sandbox vault, so it lands exactly where editing one of
 * the Tutorial's existing entries already does (see `getSandboxVaultId`).
 * Returns the key actually written
 * rather than letting callers recompute `titleToSlug(title)`: a new entry whose
 * title slugifies onto a slug some other file in that vault already owns — or
 * one that belongs to a file that failed to parse and so has no root of its
 * own — is placed on a free one, so the two no longer agree.
 */
export function saveNode(item: Occurrence | null, editScope: EditScope, fields: SaveFields, opts: SaveOpts = {}): SaveResult {
  const { title } = fields
  if (!title) return null
  const { draftId, targetVaultId } = opts

  const vaultId = item ? keyVaultId(item.entryKey) : (targetVaultId ?? getDefaultVaultId() ?? getSandboxVaultId())
  // No vault loaded at all — there is nowhere to put a new entry, and inventing
  // a target would create an unreachable root under a vault id nothing owns.
  if (!vaultId) return null

  // Not `getSnapshot()`: allocation has to see every slug this vault already
  // owns, including the two kinds that are absent from `entries` — a file that
  // failed to parse (no root, so it looks free) and one the backend has listed
  // but this device has not pulled yet. See `getSlugSnapshot`.
  const snapshot = getSlugSnapshot()
  const edited = editFieldsOf(fields)
  const { fields: toWrite, touchedKeys } = item
    ? widenEdits(item, editScope, edited, opts.edits)
    : { fields: edited, touchedKeys: undefined }
  const nextData = applyEdit(
    snapshot, item, editScope, toWrite,
    { vaultId, draftId },
    touchedKeys,
  )
  // Same snapshot, vault and draftId as the applyEdit above, so this is exactly
  // the key applyNew allocated for it.
  const entryKey = item?.entryKey ?? newEntryKey(snapshot, vaultId, title, draftId)
  commitNext(nextData, [entryKey])
  return entryKey
}

/**
 * Set or clear an entry's archived flag and persist it. The one shared write
 * path for both directions: `deleteNode`'s "Archive instead" (below) and
 * `useEntryEditor`'s Unarchive banner action call this the same way — see
 * `plans/archived-entries.md` PR 2. What actually changes on disk is
 * `setArchived` (`model/storeOps.ts`); this just wires it to `commitNext`.
 */
export function archiveEntry(entryKey: EntryKey, archived: boolean): void {
  const next = setArchived(getSnapshot(), entryKey, archived)
  commitNext(next, [entryKey])
}

export function deleteNode(
  item:             Occurrence | null,
  navigateBack:     () => void,
  onShowSeries?:    (config: SeriesSheetConfig) => void,
  onHideSeries?:    () => void,
  onConfirmSingle?: (title: string, onConfirm: () => void, onArchive: () => void) => void,
): void {
  if (!item) return
  const items     = getItems()
  const series    = findSeries(items, item)
  const slugItems = entryKeyItems(items, item.entryKey)
  const isSelf      = (i: StoreItem) => i.id === item.id
  const hasSiblings = slugItems.some(i => !isSeries(i) && !isSelf(i) && !i.excluded)
  const isRecurring = !!item.ownerId
  const isScheduled = series?.repeat.type === 'schedule'
  const title       = item.metadata.title

  function hideSheet() { onHideSeries?.() }

  function excludeThis() {
    if (!item) return
    const next = excludeOccurrence(getSnapshot(), item)
    commitNext(next, [item.entryKey])
    hideSheet(); navigateBack()
  }
  function deleteAll() {
    if (!item) return
    const { data: next, affectedKeys } = deleteByEntryKey(getSnapshot(), item.entryKey)
    commitDelete(next, item.entryKey, affectedKeys)
    hideSheet(); navigateBack()
  }
  function deleteFuture() {
    if (!item) return
    const next = deleteFollowing(getSnapshot(), item)
    commitNext(next, [item.entryKey])
    hideSheet(); navigateBack()
  }
  // No hideSheet()/navigateBack(): archiving neither removes the entry nor
  // shows anything the dialog stack itself doesn't already tear down — both
  // callers' own dialogs close themselves right after invoking this (see
  // DeleteDialog and SeriesDeleteDialog). The entry stays open, now showing
  // EntryEditor's archived banner.
  function archiveThis() {
    if (!item) return
    archiveEntry(item.entryKey, true)
  }

  if (!isRecurring && !hasSiblings) {
    const doDelete = () => {
      const { data: next, affectedKeys } = deleteByEntryKey(getSnapshot(), item.entryKey)
      commitDelete(next, item.entryKey, affectedKeys)
      navigateBack()
    }
    if (onConfirmSingle) { onConfirmSingle(title, doDelete, archiveThis); return }
    doDelete()
    return
  }

  const endsSeries = deletionEndsAfterCompletionSeries(items, item)

  const options: SeriesSheetOption[] = [
    {
      icon: 'calendar', label: 'This occurrence', sublabel: 'Remove only this occurrence', onClick: excludeThis,
      ...(endsSeries ? { warning: 'This series only creates its next occurrence when you complete the current one. Deleting this occurrence leaves nothing to complete, so the series ends here.' } : {}),
    },
  ]
  if (isScheduled) {
    options.push({ icon: 'calendar-range', label: 'This and all following', sublabel: 'Remove this and all future occurrences', onClick: deleteFuture })
    options.push({ icon: 'calendar-range', label: 'All occurrences',        sublabel: 'Remove all occurrences',                  onClick: deleteAll   })
  } else {
    options.push({ icon: 'calendar-range', label: 'All occurrences',        sublabel: 'Remove all occurrences',                  onClick: deleteAll   })
  }

  onShowSeries?.({ title: `Delete "${title}"`, options, onArchive: archiveThis })
}
