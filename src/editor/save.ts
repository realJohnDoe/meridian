import { startOfToday } from 'date-fns'
import { fmtISO, applyEdit, mergeEditFields, joinFileMeta, newEntryKey, excludeOccurrence, deletionEndsAfterCompletionSeries, deleteByEntryKey, deleteFollowing, entryKeyItems, findSeries } from '@/model'
import { isSeries, isTracked } from '@/types'
import type { Occurrence, Repeat, Scheduled, StoreItem, EditScope } from '@/types'
import type { EditFields } from '@/model'
import { getSnapshot, getEntries, getItems, getUnreadableFiles, getDefaultVaultId } from '@/storeBridge'
import { keyVaultId } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { commitNext, commitDelete } from '@/storeCommit'
import type { EntryState, ItemType } from './state'

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
export type SeriesSheetConfig = { title: string; options: SeriesSheetOption[] }

// ── ENTRY EDITOR HELPERS ──────────────────────────────────────

export function applyScope(
  item:   Occurrence,
  scope:  EditScope,
  items?: StoreItem[],
): { scheduled: Scheduled | null; repeat: Repeat | null } {
  const allItems = items ?? getItems()
  const parentSeries = item.ownerId
    ? (allItems.find(i => isSeries(i) && i.id === item.ownerId) ?? null)
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

/** The eleven store-owned fields an editor save carries. */
function editFieldsOf(fields: SaveFields): EditFields {
  return {
    title:        fields.title,
    tags:         fields.tags,
    items:        fields.items,
    participants: fields.participants,
    body:         fields.body,
    tracked:      fields.tracked,
    done:         fields.done,
    priority:     fields.priority     ?? null,
    scheduled:    fields.scheduled    ?? null,
    duration:     fields.duration,
    repeat:       fields.repeat       ?? null,
  }
}

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
  if (!live || isSeries(live)) {
    return { ...next, title: entry.root.title, body: entry.root.body ?? '', tags: [...entry.root.tags], items: [...entry.root.items] }
  }

  // A one-entry Roots map: `joinFileMeta` only ever looks up this key, and
  // building it here keeps the store's full roots map out of this path.
  const joined = joinFileMeta(item.entryKey, live.metadata, new Map([[item.entryKey, entry.root]]))
  return editFieldsOf(entryFromOccurrence({ ...live, metadata: joined }, editScope, getItems()))
}

/**
 * Narrow a save to the fields the user actually touched, leaving every other
 * field at whatever the store holds *now*.
 *
 * An editor loads its fields once and never re-reads them (by design — a live
 * re-read would move the cursor and reshuffle the form under the user's
 * hands). So the longer it stays open, the staler the fields nobody is editing
 * become, and a blind full-entry write turns every one of them into a
 * regression: the reschedule that arrived from another device, the checkbox
 * ticked from the agenda, the description someone else finished writing. On a
 * synced vault each of those regressions is also a push, which the other device
 * sees as a change worth pushing back — the loop that turns one conflict into a
 * run of conflict copies.
 *
 * Not applied to `add` scope: that save creates a *new* occurrence rather than
 * updating the one the editor is holding, so "what this entry looks like now"
 * is not the right base for it — `entryFromOccurrence` deliberately answers
 * with today's date and a cleared `done` for that scope.
 */
function touchedFieldsOnly(
  item:      Occurrence,
  editScope: EditScope,
  next:      EditFields,
  base:      SaveFields | null | undefined,
): EditFields {
  if (!base || editScope === 'add') return next
  return mergeEditFields(editFieldsOf(base), next, currentFields(item, editScope, next))
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
   * The fields as the editor last knew them to agree with the store — its
   * load-time snapshot, advanced to each save it makes. Everything `fields`
   * changes relative to this is written; everything it doesn't is left alone.
   * See `touchedFieldsOnly`. Omitted for a brand-new entry, which has no
   * ancestor and no other writer to lose a race with.
   */
  base?: SaveFields | null
}

/**
 * Persist an editor save.
 *
 * An existing item keeps its own vault (it rides inside its key); a new one goes
 * to `opts.targetVaultId` if the editor's vault chip picked one, else to the
 * default vault. Returns the key actually written
 * rather than letting callers recompute `titleToSlug(title)`: a new entry whose
 * title slugifies onto a slug some other file in that vault already owns — or
 * one that belongs to a file that failed to parse and so has no root of its
 * own — is placed on a free one, so the two no longer agree.
 */
export function saveNode(item: Occurrence | null, editScope: EditScope, fields: SaveFields, opts: SaveOpts = {}): SaveResult {
  const { title } = fields
  if (!title) return null
  const { draftId, targetVaultId } = opts

  const vaultId = item ? keyVaultId(item.entryKey) : (targetVaultId ?? getDefaultVaultId())
  // No vault loaded at all — there is nowhere to put a new entry, and inventing
  // a target would create an unreachable root under a vault id nothing owns.
  if (!vaultId) return null

  // unreadableKeys makes newEntryKey/applyNew treat a file that failed to
  // parse as occupied even though it has no root: without this, a new entry
  // whose title slugifies onto that slug would look free and silently
  // overwrite the file on write — see reportParseFailures in storage/parseReport.ts.
  const snapshot = { ...getSnapshot(), unreadableKeys: new Set(getUnreadableFiles().keys()) }
  const edited = editFieldsOf(fields)
  const nextData = applyEdit(
    snapshot, item, editScope,
    item ? touchedFieldsOnly(item, editScope, edited, opts.base) : edited,
    { vaultId, draftId },
  )
  // Same snapshot, vault and draftId as the applyEdit above, so this is exactly
  // the key applyNew allocated for it.
  const entryKey = item?.entryKey ?? newEntryKey(snapshot, vaultId, title, draftId)
  commitNext(nextData, [entryKey])
  return entryKey
}

export function deleteNode(
  item:             Occurrence | null,
  navigateBack:     () => void,
  onShowSeries?:    (config: SeriesSheetConfig) => void,
  onHideSeries?:    () => void,
  onConfirmSingle?: (title: string, onConfirm: () => void) => void,
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

  if (!isRecurring && !hasSiblings) {
    const doDelete = () => {
      const { data: next, affectedKeys } = deleteByEntryKey(getSnapshot(), item.entryKey)
      commitDelete(next, item.entryKey, affectedKeys)
      navigateBack()
    }
    if (onConfirmSingle) { onConfirmSingle(title, doDelete); return }
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

  onShowSeries?.({ title: `Delete "${title}"`, options })
}
