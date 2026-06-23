import { fmtISO } from '@/model/dateUtils'
import {
  applyEdit, excludeOccurrence, deleteByFileSlug, deleteFollowing,
  fileSlugItems, findSeries,
} from '@/model/storeOps'
import { isSeries } from '@/types'
import type { Occurrence, Repeat, Scheduled, StoreItem, EditScope } from '@/types'
import { titleToSlug } from '@/fileIO'
import { getItems, getRoots } from '@/storeBridge'
import { backlinksTo } from '@/fileOccurrence'
import { commitNext, commitDelete } from '@/storeCommit'
import type { EntryState, ItemType } from './state'

// ── BACKLINK HELPERS ──────────────────────────────────────────

/** Add `[[sourceSlug]]` to targetSlug's items list if not already present. */
export function addItemLink(targetSlug: string, sourceSlug: string): void {
  const roots = getRoots()
  const file = roots.get(targetSlug)
  if (!file) return
  const stored = `[[${sourceSlug}]]`
  if ((file.items ?? []).includes(stored)) return
  const newRoots = new Map(roots)
  newRoots.set(targetSlug, { ...file, items: [...(file.items ?? []), stored] })
  commitNext({ items: getItems(), roots: newRoots }, [targetSlug])
}

/** Remove `[[sourceSlug]]` from targetSlug's items list. */
export function removeItemLink(targetSlug: string, sourceSlug: string): void {
  const roots = getRoots()
  const file = roots.get(targetSlug)
  if (!file) return
  const stored = `[[${sourceSlug}]]`
  const newRoots = new Map(roots)
  newRoots.set(targetSlug, { ...file, items: (file.items ?? []).filter(i => i !== stored) })
  commitNext({ items: getItems(), roots: newRoots }, [targetSlug])
}

// ── SERIES-DELETE SHEET CONFIG ────────────────────────────────

export type SeriesSheetOption = {
  icon: 'calendar' | 'calendar-range'
  label: string
  sublabel: string
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
  if (scope === 'add')    { const t = new Date(); t.setHours(0, 0, 0, 0); return { scheduled: { date: fmtISO(t), time: occTime || '' }, repeat: null } }
  return { scheduled: rootDate ? { date: rootDate, time: (rootTime as string) || '' } : null, repeat: seriesRepeat || null }
}

export function entryFromOccurrence(
  item:      Occurrence,
  editScope: EditScope,
  items?:    StoreItem[],
): EntryState {
  const m = item.metadata
  const { scheduled, repeat } = applyScope(item, editScope, items)
  const tracked  = m.done !== undefined
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
    done:         m.done     ?? false,
    tags:         [...(m.tags         || [])],
    items:        [...(m.items        || [])],
    participants: [...(m.participants || [])],
    priority:     (m.priority || null) as EntryState['priority'],
    editScope,
  }
}

// ── MUTATION API ──────────────────────────────────────────────

type SaveFields = EntryState & { body: string }

export type SaveResult = 'saved' | 'missing-title' | 'missing-date'

export function saveNode(item: Occurrence | null, editScope: EditScope, fields: SaveFields): SaveResult {
  const { title } = fields
  if (!title) return 'missing-title'

  if (editScope === 'add' && item && !fields.scheduled?.date) {
    return 'missing-date'
  }

  const nextData = applyEdit({ items: getItems(), roots: getRoots() }, item, editScope, {
    title,
    tags:         fields.tags         ?? [],
    items:        fields.items        ?? [],
    participants: fields.participants  ?? [],
    body:         fields.body         ?? '',
    tracked:      fields.tracked      ?? false,
    done:         fields.done         ?? false,
    priority:     fields.priority     ?? null,
    scheduled:    fields.scheduled    ?? null,
    duration:     fields.duration     ?? '',
    repeat:       fields.repeat       ?? null,
  })
  const fileSlug = item?.fileSlug ?? titleToSlug(title)
  if (fileSlug) commitNext(nextData, [fileSlug])
  return 'saved'
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
  const slugItems = fileSlugItems(items, item.fileSlug)
  const isSelf      = (i: StoreItem) => i.id === item.id
  const hasSiblings = slugItems.some(i => !isSeries(i) && !isSelf(i) && !i.excluded)
  const isRecurring = !!item.ownerId
  const isScheduled = series?.repeat?.type === 'schedule'
  const title       = item.metadata.title

  function hideSheet() { onHideSeries?.() }

  function excludeThis() {
    if (!item) return
    const next = excludeOccurrence({ items: getItems(), roots: getRoots() }, item)
    commitNext(next, [item.fileSlug])
    hideSheet(); navigateBack()
  }
  function deleteAll() {
    if (!item) return
    const affected = backlinksTo(item.fileSlug, getRoots())
    const next = deleteByFileSlug({ items: getItems(), roots: getRoots() }, item.fileSlug)
    commitDelete(next, item.fileSlug, affected)
    hideSheet(); navigateBack()
  }
  function deleteFuture() {
    if (!item) return
    const next = deleteFollowing({ items: getItems(), roots: getRoots() }, item)
    commitNext(next, [item.fileSlug])
    hideSheet(); navigateBack()
  }

  if (!isRecurring && !hasSiblings) {
    const doDelete = () => {
      const affected = backlinksTo(item.fileSlug, getRoots())
      const next = deleteByFileSlug({ items: getItems(), roots: getRoots() }, item.fileSlug)
      commitDelete(next, item.fileSlug, affected)
      navigateBack()
    }
    if (onConfirmSingle) { onConfirmSingle(title, doDelete); return }
    doDelete()
    return
  }

  const options: SeriesSheetOption[] = [
    { icon: 'calendar', label: 'This occurrence', sublabel: 'Remove only this occurrence', onClick: excludeThis },
  ]
  if (isScheduled) {
    options.push({ icon: 'calendar-range', label: 'This and all following', sublabel: 'Remove this and all future occurrences', onClick: deleteFuture })
    options.push({ icon: 'calendar-range', label: 'All occurrences',        sublabel: 'Remove all occurrences',                  onClick: deleteAll   })
  } else {
    options.push({ icon: 'calendar-range', label: 'All occurrences',        sublabel: 'Remove all occurrences',                  onClick: deleteAll   })
  }

  onShowSeries?.({ title: `Delete "${title}"`, options })
}
