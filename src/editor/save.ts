import { startOfToday } from 'date-fns'
import { fmtISO, applyEdit, newEntryKey, excludeOccurrence, deletionEndsAfterCompletionSeries, deleteByEntryKey, deleteFollowing, entryKeyItems, findSeries } from '@/model'
import { isSeries, isTracked } from '@/types'
import type { Occurrence, Repeat, Scheduled, StoreItem, EditScope } from '@/types'
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

/**
 * Persist an editor save.
 *
 * `draftId` identifies the draft when `item` is null (a brand-new entry), so a
 * second create-scoped save for the same draft upserts onto the file the first
 * one made instead of creating another — see `applyNew`.
 *
 * An existing item keeps its own vault (it rides inside its key); a new one goes
 * to `targetVaultId` if the editor's vault chip picked one, else to the default
 * vault. Returns the key actually written
 * rather than letting callers recompute `titleToSlug(title)`: a new entry whose
 * title slugifies onto a slug some other file in that vault already owns — or
 * one that belongs to a file that failed to parse and so has no root of its
 * own — is placed on a free one, so the two no longer agree.
 */
export function saveNode(item: Occurrence | null, editScope: EditScope, fields: SaveFields, draftId?: string, targetVaultId?: string | null): SaveResult {
  const { title } = fields
  if (!title) return null

  const vaultId = item ? keyVaultId(item.entryKey) : (targetVaultId ?? getDefaultVaultId())
  // No vault loaded at all — there is nowhere to put a new entry, and inventing
  // a target would create an unreachable root under a vault id nothing owns.
  if (!vaultId) return null

  // unreadableKeys makes newEntryKey/applyNew treat a file that failed to
  // parse as occupied even though it has no root: without this, a new entry
  // whose title slugifies onto that slug would look free and silently
  // overwrite the file on write — see reportParseFailures in storage/sync.ts.
  const snapshot = { ...getSnapshot(), unreadableKeys: new Set(getUnreadableFiles().keys()) }
  const nextData = applyEdit(snapshot, item, editScope, {
    title,
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
  }, { vaultId, draftId })
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
