import { fmtISO } from './model/expansion'
import {
  applyEdit, toggleDone, excludeOccurrence, deleteByFileSlug, deleteFollowing,
  fileSlugItems, findSeries,
} from './model/storeOps'
import { isSeries, occIsRecur } from './types'
import type { Occurrence, Repeat, Scheduled, Priority, StoreItem, EditScope } from './types'
import { titleToSlug } from './fileIO'
import { getItems, getRoots, setData, navigateBack, notify } from './storeBridge'
import { writeEntityToCache, deleteFileFromDisk } from './vault'
import { toast } from 'sonner'
import { TODAY } from './constants'
import type { EntryState, ItemType } from './components/EntryEditor'

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
  if (scope === 'add')    return { scheduled: { date: fmtISO(TODAY), time: occTime || '' }, repeat: null }
  return { scheduled: rootDate ? { date: rootDate, time: (rootTime as string) || '' } : null, repeat: seriesRepeat || null }
}

export function entryFromOccurrence(
  item:          Occurrence,
  editScope:     EditScope,
  bodyTransform: (body: string) => string = b => b,
  items?:        StoreItem[],
): EntryState {
  const m = item.metadata
  const { scheduled, repeat } = applyScope(item, editScope, items)
  const tracked  = m.done !== undefined
  const itemType: ItemType = tracked ? 'task' : scheduled ? 'event' : 'note'
  return {
    item,
    title:        m.title    || '',
    bodyHtml:     bodyTransform(m.body || ''),
    scheduled,
    repeat,
    duration:     m.duration || '',
    tracked,
    itemType,
    done:         m.done     ?? false,
    tags:         [...(m.tags         || [])],
    topics:       [...(m.topics       || [])],
    participants: [...(m.participants || [])],
    priority:     (m.priority || null) as Priority | null,
    editScope,
  }
}

// ── MUTATION API ──────────────────────────────────────────────

type SaveFields = EntryState & { body: string }

export function saveNode(item: Occurrence | null, editScope: EditScope, fields: SaveFields): void {
  const { title } = fields
  if (!title) return

  if (editScope === 'add' && item && !fields.scheduled?.date) {
    notify('Please set a date for the new occurrence.')
    return
  }

  const nextData = applyEdit({ items: getItems(), roots: getRoots() }, item, editScope, {
    title,
    tags:         fields.tags         ?? [],
    topics:       fields.topics       ?? [],
    participants: fields.participants  ?? [],
    body:         fields.body         ?? '',
    tracked:      fields.tracked      ?? false,
    done:         fields.done         ?? false,
    priority:     fields.priority     ?? null,
    scheduled:    fields.scheduled    ?? null,
    duration:     fields.duration     ?? '',
    repeat:       fields.repeat       ?? null,
  })
  setData(nextData)

  // Determine which fileSlug to persist. For a brand-new item the slug is derived
  // from the title — matching applyEdit — so undated tasks/notes are persisted too.
  const fileSlug = item?.fileSlug ?? titleToSlug(title)
  if (fileSlug) writeEntityToCache(fileSlug)
  navigateBack()
}

export function toggleOccDone(o: Occurrence): void {
  const next = toggleDone({ items: getItems(), roots: getRoots() }, o)
  o.metadata.done = !o.metadata.done  // optimistic UI
  setData(next)
  writeEntityToCache(o.fileSlug)
}

export function beginSwipeDelete(o: Occurrence): () => void {
  const snapshot = { items: getItems(), roots: getRoots() }
  const title    = o.metadata.title   // expanded occurrence already carries the file-level title
  let cancelled  = false

  if (occIsRecur(o)) {
    const next = excludeOccurrence(snapshot, o)
    showDeleteToast(title,
      () => { writeEntityToCache(o.fileSlug) },
      () => { cancelled = true; setData(snapshot) },
    )
    return () => { if (!cancelled) setData(next) }
  } else {
    showDeleteToast(title,
      () => { deleteFileFromDisk(o.fileSlug) },
      () => {
        cancelled = true
        if (!getItems().find(i => i.id === o.id)) setData(snapshot)
      },
    )
    return () => {
      if (!cancelled) setData(deleteByFileSlug({ items: getItems(), roots: getRoots() }, o.fileSlug))
    }
  }
}

export function deleteNode(
  item:             Occurrence | null,
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
  const title       = item.metadata.title   // expanded occurrence already carries the file-level title

  function hideSheet() { onHideSeries?.() }

  function excludeThis() {
    if (!item) return
    setData(excludeOccurrence({ items: getItems(), roots: getRoots() }, item))
    writeEntityToCache(item.fileSlug)
    hideSheet(); navigateBack()
  }
  function deleteAll() {
    if (!item) return
    setData(deleteByFileSlug({ items: getItems(), roots: getRoots() }, item.fileSlug))
    deleteFileFromDisk(item.fileSlug)
    hideSheet(); navigateBack()
  }
  function deleteFuture() {
    if (!item) return
    setData(deleteFollowing({ items: getItems(), roots: getRoots() }, item))
    writeEntityToCache(item.fileSlug)
    hideSheet(); navigateBack()
  }

  // Non-recurring, single occurrence.
  if (!isRecurring && !hasSiblings) {
    const doDelete = () => {
      setData(deleteByFileSlug({ items: getItems(), roots: getRoots() }, item.fileSlug))
      deleteFileFromDisk(item.fileSlug); navigateBack()
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

// ── UNDO TOAST MANAGER ────────────────────────────────────────

let _toastId:       string | number | null = null
let _pendingCommit: (() => void) | null    = null
const TOAST_MS = 4000

function showDeleteToast(title: string, commitFn: () => void, undoFn: () => void): void {
  // Commit any previous pending deletion before showing the new toast.
  // Clear _pendingCommit first so the dismiss callback below is a no-op.
  if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
  if (_toastId !== null) { toast.dismiss(_toastId); _toastId = null }

  _pendingCommit = commitFn
  _toastId = toast(`Deleted: ${title}`, {
    duration: TOAST_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        _pendingCommit = null
        _toastId = null
        undoFn()
      },
    },
    onDismiss: () => {
      if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
      _toastId = null
    },
    onAutoClose: () => {
      if (_pendingCommit) { _pendingCommit(); _pendingCommit = null }
      _toastId = null
    },
  })
}
