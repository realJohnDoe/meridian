import { useState, useEffect, useRef } from 'react'
import { startOfToday } from 'date-fns'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '@/store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode } from './save'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO, seriesContext } from '@/model'
import { useToday } from '@/hooks'
import { newEntryRoute, keyRoute } from '@/routes'
import { resolveWikilink } from '@/wikilinks'
import { keyVaultId, keySlug } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { toggleOccDone } from '@/occurrenceActions'
import { getFom } from '@/storeBridge'
import { readVaultStringArray } from '@/lib/vaultStorage'
import { type EntryState, type ItemType, ENTRY_DEFAULT } from './state'
import { useEntryDialogs } from './useEntryDialogs'
import { usePendingLinks } from './usePendingLinks'

export type { DialogHandlers } from './useEntryDialogs'

export interface NewEntrySeed {
  date?: string
  time?: string
  duration?: string
  itemType?: ItemType
  /** Which vault to create in, overriding `defaultVaultId`. From the `vault` search param. */
  vault?: string
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
  const today = useToday()

  // Which vault a brand-new entry will land in, changeable via the vault chip
  // until the first save creates the file. Null for an existing entry — its
  // vault is fixed, and rides inside its own key.
  const [targetVaultId, setTargetVaultId] = useState<string | null>(
    () => initialOcc ? null : (seed?.vault ?? useStore.getState().defaultVaultId),
  )

  // Read from the *target* vault, not from whatever `loadDefaultParticipants`
  // last cached: with the vault chip able to point a new entry elsewhere, the
  // seed has to match where the entry actually lands.
  const [entry, setEntry] = useState<EntryState>(() => {
    const defaultParticipants = (!initialOcc && targetVaultId)
      ? readVaultStringArray('meridian_default_participants', targetVaultId)
      : []
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

  // The key a brand-new entry actually landed on, once its first save created the
  // file. Not necessarily `titleToSlug(entry.title)`: a title that slugifies onto a
  // slug another file already owns gets placed on a free one instead. Kept in state
  // (not a ref) because it feeds the favourite button and the "listed on" target.
  const [createdKey, setCreatedKey] = useState<EntryKey | null>(null)

  // An existing entry's vault is its own; a brand-new one lands in the default
  // vault unless the route overrode it (the new-entry vault chip). Both the
  // link picker and wikilink resolution below are scoped to it — a `[[slug]]`
  // only ever means a file in the same vault.
  const defaultVaultId = useStore(s => s.defaultVaultId)
  const vaultId = entry.item ? keyVaultId(entry.item.entryKey) : (targetVaultId ?? defaultVaultId)

  const { effectiveKey, pendingKeys, handleAdd, handleRemove, flushOnSave } =
    usePendingLinks(entry.item, entry.title, vaultId, createdKey)
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
  // Identity of this editor session's draft, stamped on the item its first save
  // creates. It's what lets applyNew tell a repeat commit for *this* draft (upsert)
  // from a different entry landing on a taken slug (allocate a free slug) — the
  // createdItemRef adoption below covers the same ground, but only once the fom
  // lookup has succeeded, and handleSave/dialog paths can commit before then.
  const [draftId] = useState(() => crypto.randomUUID())

  const storeRoots = useStore(s => s.roots)
  const storeItems = useStore(s => s.items)
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
      const key = saveNode(item, next.editScope, next)
      setTitleMissing(key === null)
      // No-op once `next.item` itself is set (usePendingLinks already flushes
      // immediately in that case) — but while item only lives in
      // createdItemRef, entry.item is still null, so pending "listed on" links
      // added after creation would otherwise never get flushed again.
      if (key) flushLinksRef.current(keySlug(key))
      return
    }
    if (!next.title) return
    const key = saveNode(null, next.editScope, next, draftId, targetVaultId)
    if (key === null) { setTitleMissing(true); return }
    setTitleMissing(false)
    flushLinksRef.current(keySlug(key))
    setCreatedKey(key)
    createdItemRef.current = getFom().get(key) ?? null
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

  // The unmount flush must run the *latest* flushAutoSave, not the one from
  // mount — it commits whatever edit is pending at teardown. Standard
  // latest-ref: a depless effect refreshes it after every commit, and the
  // cleanup below reads it. Replaces an exhaustive-deps suppression, which
  // would have opted this hook out of React Compiler optimization entirely.
  const flushAutoSaveRef = useRef(flushAutoSave)
  useEffect(() => { flushAutoSaveRef.current = flushAutoSave })
  useEffect(() => () => { flushAutoSaveRef.current() }, [])

  // A new item opened with an initial title (e.g. "Add <query>" from search, or a
  // wikilink to a not-yet-existing note) already has everything needed to create the
  // file — don't wait for the user to make an edit that would trigger autosave.
  // Mount-time values by construction: this fires once, before any edit could
  // have changed initialOcc or rebuilt commitEntry.
  const initialCommitRef = useRef({ initialOcc, commitEntry })
  useEffect(() => {
    const { initialOcc: occAtMount, commitEntry: commitAtMount } = initialCommitRef.current
    if (!occAtMount && entryRef.current.title) commitAtMount(entryRef.current)
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
    // Resolved inside this entry's own vault: a bare `[[slug]]` in a file means
    // that vault's slug, never another vault's file that happens to match.
    const target = vaultId ? resolveWikilink(ref, storeRoots, vaultId) : undefined
    if (!target) {
      void navigate(newEntryRoute(ref))
      return
    }
    void navigate(keyRoute(target))
  }

  const goBack = () => {
    flushAutoSave()
    if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/' })
  }

  const handleSave = (body: string) => {
    // Same fallback as commitEntry: once autosave has created the file, entry.item is
    // still deliberately null, so saving must target the adopted item rather than ask
    // for another new entry. draftIdRef covers the window before that adoption lands.
    const item = entry.item ?? createdItemRef.current
    const key = saveNode(item, entry.editScope, { ...entry, body }, draftId, targetVaultId)
    if (key !== null) { setTitleMissing(false); goBack(); return }
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

  // Promotes a checklist line into an entry of its own. No draft id: each
  // promotion is a genuinely new entry, so a title that slugifies onto an
  // existing file's slug gets its own free slug rather than overwriting that
  // file. saveNode reports which key that was — the checklist line is rewritten
  // to a wikilink pointing at its BARE slug (that is what goes in a file), so it
  // must be the real one, not titleToSlug(title).
  const handlePromoteTask = (title: string, done: boolean): string | null => {
    const key = saveNode(null, 'all', {
      item: null, title, tracked: true, itemType: 'task', done,
      body: '', tags: [], items: [], participants: [...useStore.getState().defaultParticipants],
      priority: null, scheduled: null, duration: '', repeat: null,
      editScope: 'all',
    }, undefined, targetVaultId)
    if (key === null) return null
    void navigate(keyRoute(key))
    return keySlug(key)
  }

  // Which repeat/scope controls the editor offers is a property of the series
  // this occurrence hangs off — derived in model/, not in the render body.
  const series = seriesContext(storeItems, entry.item)

  return {
    entry, setEntry,
    createdKey,
    vaultId,
    // Null once the entry exists — the chip becomes a picker only in PR 5's
    // move flow; before the first save it retargets where the file is created.
    setTargetVaultId: entry.item ?? createdItemRef.current ? null : setTargetVaultId,
    series,
    pendingLinks: { effectiveKey, pendingKeys, handleAdd, handleRemove },
    saveMeta,
    handleOpenWikilink,
    handleSave,
    handleDelete,
    handleClose,
    handleScopeChange,
    handleTypeChange,
    handleDoneToggle,
    handlePromoteTask,
    // Ticking a checklist line that points at another entry commits to *that*
    // file, not this one — it goes straight through the shared occurrence
    // action rather than this editor's save path.
    handleToggleDoneBacklink: toggleOccDone,
    handleOpenDlg: dialogs.handleOpenDlg,
    handleOpenRepeatDlg: dialogs.handleOpenRepeatDlg,
    dialogHandlers: dialogs.dialogHandlers,
    scheduleAutoSave,
    titleMissing,
    focusTitleTick,
  }
}
