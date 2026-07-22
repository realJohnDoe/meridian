import { useState, useEffect, useRef } from 'react'
import { startOfToday } from 'date-fns'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '@/store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from './save'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO } from '@/model'
import { useToday } from '@/hooks'
import { newEntryRoute } from '@/routes'
import { resolveWikilink } from '@/wikilinks'
import { titleToSlug } from '@/fileIO'
import { getFom } from '@/storeBridge'
import { type EntryState, type ItemType, ENTRY_DEFAULT } from './state'
import { useEntryDialogs } from './useEntryDialogs'
import { usePendingLinks } from './usePendingLinks'

export type { DialogHandlers } from './useEntryDialogs'

export interface NewEntrySeed {
  date?: string
  time?: string
  duration?: string
  itemType?: ItemType
}

function entryFromItem(item: Occurrence | null, editScope: EditScope, seed?: NewEntrySeed): EntryState {
  if (!item) {
    const itemType = seed?.itemType ?? ENTRY_DEFAULT.itemType
    return {
      ...ENTRY_DEFAULT,
      editScope,
      itemType,
      tracked: itemType === 'task',
      scheduled: { date: seed?.date ?? fmtISO(startOfToday()), time: seed?.time ?? '' },
      duration: seed?.duration ?? '',
    }
  }
  return entryFromOccurrence(item, editScope)
}

export function useEntryEditor(initialOcc: Occurrence | null, initialScope: EditScope = 'single', initialTitle?: string, seed?: NewEntrySeed) {
  const defaultParticipants = useStore.getState().defaultParticipants
  const today = useToday()

  const [entry, setEntry] = useState<EntryState>(() => {
    const base = entryFromItem(initialOcc, initialScope, seed)
    const seeded = (!initialOcc && defaultParticipants.length > 0)
      ? { ...base, participants: [...defaultParticipants] }
      : base
    return initialTitle ? { ...seeded, title: initialTitle } : seeded
  })

  const [titleMissing, setTitleMissing] = useState(false)
  const [focusTitleTick, setFocusTitleTick] = useState(0)

  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always holds the latest body: initialized from entry.body, then kept current by
  // every scheduleAutoSave call (which fires synchronously on each CM6 doc change,
  // independent of the debounced commit). Read by saveMeta/flushAutoSave so a
  // meta-only save can capture the current body without reaching into CodeMirror.
  const bodyRef = useRef(entry.body)

  const { effectiveSlug, pendingSlugs, handleAdd, handleRemove, flushOnSave } = usePendingLinks(entry.item, entry.title)
  // Mirrors the latest flushOnSave (its closure changes every render as pendingSlugs/item
  // change) so timer/dialog-driven commits — which may fire after several re-renders —
  // flush against the current pending links instead of a stale render's closure.
  const flushLinksRef = useRef(flushOnSave)
  useEffect(() => { flushLinksRef.current = flushOnSave })

  // Always points to the latest entry so timer callbacks don't close over stale state
  const entryRef = useRef(entry)
  useEffect(() => { entryRef.current = entry }, [entry])
  // Once a brand-new item's first save creates its file, this holds the resulting
  // occurrence so later commits in the same session upsert onto it (see commitEntry)
  // instead of calling applyNew again. Deliberately NOT stored on `entry.item` —
  // EntryEditor derives `bodyKey`/scope-row visibility/etc. from that field, and
  // flipping it mid-session would remount the CodeMirror body editor under the user.
  const createdItemRef = useRef<Occurrence | null>(null)

  const storeRoots = useStore(s => s.roots)
  const navigate = useNavigate()
  const router = useRouter()

  // Persists an edit. For an existing item (or one already adopted via
  // createdItemRef) this upserts in place. For a brand-new item it creates the
  // file on first save and adopts the result, so any further commit in this
  // session — a late debounced autosave, a dialog confirmed right after — also
  // upserts instead of re-running applyNew (which would otherwise append a
  // second item under the same fileSlug).
  const commitEntry = (next: EntryState) => {
    const item = next.item ?? createdItemRef.current
    if (item) {
      const result = saveNode(item, next.editScope, next)
      setTitleMissing(result === 'missing-title')
      // No-op once `next.item` itself is set (usePendingLinks already flushes
      // immediately in that case) — but while item only lives in
      // createdItemRef, entry.item is still null, so pending "listed on" links
      // added after creation would otherwise never get flushed again.
      flushLinksRef.current(titleToSlug(next.title))
      return
    }
    if (!next.title) return
    const result = saveNode(null, next.editScope, next)
    if (result !== 'saved') { setTitleMissing(true); return }
    setTitleMissing(false)
    flushLinksRef.current(titleToSlug(next.title))
    createdItemRef.current = getFom().get(titleToSlug(next.title)) ?? null
  }

  const saveMeta = (next: EntryState) => {
    if (next.editScope === 'add') return
    commitEntry({ ...next, body: bodyRef.current })
  }

  // Commits a still-pending debounced autosave immediately instead of letting it
  // fire late (or never — the cleanup below would otherwise just clearTimeout it).
  const flushAutoSave = () => {
    if (!autosaveTimerRef.current) return
    clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = null
    commitEntry({ ...entryRef.current, body: bodyRef.current })
  }

  // Drops a still-pending autosave without committing it — used right before a
  // delete so goBack's flushAutoSave (called from deleteNode's navigateBack
  // callback) can't resurrect the item that's about to be removed via a stale
  // commitEntry.
  const cancelAutoSave = () => {
    if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null }
  }

  useEffect(() => () => {
    flushAutoSave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A new item opened with an initial title (e.g. "Add <query>" from search, or a
  // wikilink to a not-yet-existing note) already has everything needed to create the
  // file — don't wait for the user to make an edit that would trigger autosave.
  useEffect(() => {
    if (!initialOcc && entryRef.current.title) commitEntry(entryRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateEntry = (next: EntryState) => {
    setEntry(next)
    saveMeta(next)
  }

  const scheduleAutoSave = (body: string) => {
    if (entryRef.current.editScope === 'add') return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    bodyRef.current = body
    autosaveTimerRef.current = setTimeout(() => {
      commitEntry({ ...entryRef.current, body })
      autosaveTimerRef.current = null
    }, 1500)
  }

  const handleOpenWikilink = (ref: string) => {
    const fileSlug = resolveWikilink(ref, storeRoots)
    if (!fileSlug) {
      void navigate(newEntryRoute(ref))
      return
    }
    void navigate({ to: '/entry/$slug', params: { slug: fileSlug } })
  }

  const goBack = () => {
    flushAutoSave()
    if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/' })
  }

  const handleSave = (body: string) => {
    const result = saveNode(entry.item, entry.editScope, { ...entry, body })
    if (result === 'saved') { setTitleMissing(false); goBack(); return }
    setTitleMissing(true)
    setFocusTitleTick(t => t + 1)
  }

  const dialogs = useEntryDialogs(entry, updateEntry)
  const { setSeriesSheetConfig, setPendingDelete } = dialogs

  const handleDelete = () => {
    cancelAutoSave()
    // A new item's file may already exist (via createdItemRef) even though entry.item is
    // deliberately kept null — see the comment on createdItemRef above. Fall back to it so
    // delete works once autosave has created the file. If neither exists yet, there's nothing
    // to delete — just discard the draft and close.
    const target = entry.item ?? createdItemRef.current
    if (!target) { goBack(); return }
    deleteNode(
      target,
      goBack,
      setSeriesSheetConfig,
      () => setSeriesSheetConfig(null),
      (title, onConfirm) => setPendingDelete({ title, onConfirm }),
    )
  }

  const handleClose = () => goBack()

  const handleScopeChange = (scope: EditScope) => {
    if (!entry.item) return
    const { scheduled, repeat } = applyScope(entry.item, scope)
    updateEntry({ ...entry, editScope: scope, scheduled, repeat })
  }

  const handleTypeChange = (t: ItemType) => {
    updateEntry({
      ...entry,
      itemType: t,
      tracked: t === 'task',
      priority: t !== 'task' ? null : entry.priority,
      scheduled:
        t === 'note'                         ? null
        : t === 'event' && !entry.scheduled  ? { date: fmtISO(today), time: '' }
        : entry.scheduled,
    })
  }

  const handleDoneToggle = () => {
    updateEntry({ ...entry, done: !entry.done })
  }

  return {
    entry, setEntry,
    pendingLinks: { effectiveSlug, pendingSlugs, handleAdd, handleRemove },
    saveMeta,
    handleOpenWikilink,
    handleSave,
    handleDelete,
    handleClose,
    handleScopeChange,
    handleTypeChange,
    handleDoneToggle,
    handleOpenDlg: dialogs.handleOpenDlg,
    handleOpenRepeatDlg: dialogs.handleOpenRepeatDlg,
    dialogHandlers: dialogs.dialogHandlers,
    scheduleAutoSave,
    titleMissing,
    focusTitleTick,
  }
}
