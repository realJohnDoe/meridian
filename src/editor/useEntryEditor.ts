import { useState, useEffect, useRef } from 'react'
import { startOfToday } from 'date-fns'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '@/store'
import { applyScope, entryFromOccurrence, saveNode, deleteNode, addItemLink, removeItemLink, archiveEntry } from './save'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO, seriesContext } from '@/model'
import { useToday } from '@/hooks'
import { newEntryRoute, keyRoute } from '@/routes'
import { resolveWikilink } from '@/wikilinks'
import { keySlug } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { toggleOccDone } from '@/occurrenceActions'
import { getFom } from '@/storeBridge'
import { readVaultStringArray } from '@/lib/vaultStorage'
import { type EntryState, type ItemType, ENTRY_DEFAULT } from './state'
import { useEntryDialogs } from './useEntryDialogs'
import { usePendingLinks } from './usePendingLinks'
import { useAutoSave } from './useAutoSave'
import { useVaultTarget, initialTargetVault } from './useVaultTarget'

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

export function useEntryEditor(
  initialOcc: Occurrence | null,
  initialScope: EditScope = 'single',
  initialTitle?: string,
  seed?: NewEntrySeed,
  /**
   * The identity of the draft this editor is a session of, supplied by the
   * new-entry route so it survives a remount of the same history entry — see
   * `draftId` below. Omitted (and so freshly minted) by every other caller.
   */
  sessionDraftId?: string,
) {
  const today = useToday()

  // Read from the *target* vault, not from whatever `loadDefaultParticipants`
  // last cached: with the vault chip able to point a new entry elsewhere, the
  // seed has to match where the entry actually lands. `useVaultTarget` below
  // seeds its own state from the same helper, in this same mount render.
  const [entry, setEntry] = useState<EntryState>(() => {
    const target = initialTargetVault(!initialOcc, seed?.vault)
    const defaultParticipants = target
      ? readVaultStringArray('meridian_default_participants', target)
      : []
    const base = entryFromItem(initialOcc, initialScope, seed)
    const seeded = (!initialOcc && defaultParticipants.length > 0)
      ? { ...base, participants: [...defaultParticipants] }
      : base
    return initialTitle ? { ...seeded, title: initialTitle } : seeded
  })

  const [titleMissing, setTitleMissing] = useState(false)
  const [focusTitleTick, setFocusTitleTick] = useState(0)

  // The key a brand-new entry actually landed on, once its first save created the
  // file. Not necessarily `titleToSlug(entry.title)`: a title that slugifies onto a
  // slug another file already owns gets placed on a free one instead. Kept in state
  // (not a ref) because it feeds the favourite button and the "listed on" target.
  const [createdKey, setCreatedKey] = useState<EntryKey | null>(null)

  // Mirrors the latest autosave flush for `useVaultTarget`, which stages a
  // move against the store and so must not count a link still sitting in
  // CodeMirror. The flush is built from that hook's own `vaultId`, so it can
  // only be filled in after the call — same latest-ref idiom as flushLinksRef.
  const flushEditsRef = useRef<() => void>(() => {})
  const vaultTarget = useVaultTarget(entry, createdKey, seed?.vault, flushEditsRef)
  const { vaultId, targetVaultId } = vaultTarget

  const { effectiveKey, pendingKeys, handleAdd, handleRemove, flushOnSave } =
    usePendingLinks(entry.item, entry.title, vaultId, createdKey)
  // Mirrors the latest flushOnSave (its closure changes every render as pendingSlugs/item
  // change) so timer/dialog-driven commits — which may fire after several re-renders —
  // flush against the current pending links instead of a stale render's closure.
  const flushLinksRef = useRef(flushOnSave)
  useEffect(() => { flushLinksRef.current = flushOnSave })

  // What this editor last knew the store to agree with: the fields as loaded,
  // then advanced to each save it makes. `saveNode` writes only what `entry`
  // changes relative to this, so a field nobody here touched is left at
  // whatever the store holds by then rather than reverted to what was on
  // screen when the editor opened — see `touchedFieldsOnly`.
  //
  // Advanced on save rather than left at the mount-time values: after a commit
  // the editor and the store agree again, and a base that never moves would
  // keep re-writing every field of every earlier edit forever.
  const baseRef = useRef(entry)

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
  //
  // Supplied by the new-entry route, which derives it from the history entry:
  // coming *back* to /entry/new must resume this draft rather than start a
  // second one that lands beside it on a `-2` slug.
  const [draftId] = useState(() => sessionDraftId ?? crypto.randomUUID())

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
  //
  // Returns the key it wrote, or null when nothing was written (an empty
  // title) — the link handlers below need a slug of their own to write
  // `[[this-entry]]` into another file, and only a commit can produce one.
  const commitEntry = (next: EntryState): EntryKey | null => {
    const item = next.item ?? createdItemRef.current
    if (item) {
      const key = saveNode(item, next.editScope, next, { base: baseRef.current })
      setTitleMissing(key === null)
      // No-op once `next.item` itself is set (usePendingLinks already flushes
      // immediately in that case) — but while item only lives in
      // createdItemRef, entry.item is still null, so pending "listed on" links
      // added after creation would otherwise never get flushed again.
      if (key) { baseRef.current = next; flushLinksRef.current(keySlug(key)) }
      return key
    }
    if (!next.title) return null
    const key = saveNode(null, next.editScope, next, { draftId, targetVaultId })
    if (key === null) { setTitleMissing(true); return null }
    setTitleMissing(false)
    baseRef.current = next
    flushLinksRef.current(keySlug(key))
    setCreatedKey(key)
    createdItemRef.current = getFom().get(key) ?? null
    return key
  }

  const { scheduleAutoSave, flushAutoSave, cancelAutoSave, bodyRef } = useAutoSave(commitEntry, entryRef, entry.body)
  useEffect(() => { flushEditsRef.current = flushAutoSave })

  const saveMeta = (next: EntryState) => {
    if (next.editScope === 'add') return
    commitEntry({ ...next, body: bodyRef.current })
  }

  /**
   * Put this entry on `target`'s list — the "add to list" picker's action.
   *
   * The link is `[[this-entry]]` written into the *other* file, so this entry
   * needs a slug of its own before there is anything to write. For an existing
   * one `usePendingLinks` writes it on the spot; a brand-new one is committed
   * first (creating its file, exactly as any other field edit would) and the
   * link written against the key that commit reports.
   *
   * The pick used to only land in `pendingKeys`, to be written by whatever
   * commit happened next — but Save and Back both flush nothing when no
   * autosave is pending, so a pick made last, with nothing typed after it,
   * was dropped without a trace.
   */
  const handleAddLink = (target: EntryKey) => {
    handleAdd(target)
    if (entry.item) return
    const key = commitEntry({ ...entryRef.current, body: bodyRef.current })
    if (key) addItemLink(target, keySlug(key))
  }

  /** The same, in reverse: `pendingKeys` alone can't unwrite a link a commit already flushed. */
  const handleRemoveLink = (target: EntryKey) => {
    handleRemove(target)
    if (entry.item) return
    const key = createdItemRef.current?.entryKey ?? createdKey
    if (key) removeItemLink(target, keySlug(key))
  }

  /**
   * Create the list the user just named in the picker, and put this entry on
   * it. A list is a plain note — nothing to schedule, nothing to tick.
   *
   * No draft id: each of these is a genuinely new file, so a name that
   * slugifies onto a taken slug lands on a free one rather than upserting onto
   * whatever is sitting there (same reasoning as `handlePromoteTask`). Lands in
   * `vaultId`, since the `[[link]]` about to be written resolves in that vault.
   */
  const handleCreateList = (title: string) => {
    const listTitle = title.trim()
    if (!listTitle) return
    const target = saveNode(null, 'all', {
      item: null, title: listTitle, tracked: false, itemType: 'note', done: false,
      body: '', tags: [], items: [],
      participants: vaultId ? readVaultStringArray('meridian_default_participants', vaultId) : [],
      priority: null, scheduled: null, duration: '', repeat: null,
      editScope: 'all',
    }, { targetVaultId: vaultId })
    if (!target) return
    handleAddLink(target)
  }

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
    const key = saveNode(item, entry.editScope, { ...entry, body }, { draftId, targetVaultId, base: baseRef.current })
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
      (title, onConfirm, onArchive) => setPendingDelete({ title, onConfirm, onArchive }),
    )
  }

  // The banner's Unarchive action (EntryEditor). No dialog, no navigation —
  // symmetric with `deleteNode`'s "Archive instead", which also just flips
  // the flag and leaves the editor open on the same entry.
  const handleUnarchive = () => {
    if (!effectiveKey) return
    archiveEntry(effectiveKey, false)
  }

  const handleClose = () => goBack()

  const handleScopeChange = (scope: EditScope) => {
    if (!entry.item) return
    const { scheduled, repeat } = applyScope(entry.item, scope)
    // 'add' creates a brand-new occurrence rather than editing entry.item, so it
    // must not inherit that occurrence's done state — carrying it over is what
    // made a freshly added occurrence show up checked when the one it was
    // switched from happened to be done.
    const done = scope === 'add' ? false : entry.done
    updateEntry({ ...entry, editScope: scope, scheduled, repeat, done })
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
  //
  // Lands in `vaultId` (the parent entry's own vault), not `targetVaultId` (only
  // set while a brand-new entry hasn't saved yet) — the rewritten `[[slug]]`
  // link is resolved within that same vault. Participants are read straight
  // from that vault's localStorage rather than the store's `defaultParticipants`,
  // which only caches whichever vault is currently the *default* one and goes
  // stale the moment the parent entry lives elsewhere.
  const handlePromoteTask = (title: string, done: boolean): string | null => {
    const key = saveNode(null, 'all', {
      item: null, title, tracked: true, itemType: 'task', done,
      body: '', tags: [], items: [], participants: vaultId ? readVaultStringArray('meridian_default_participants', vaultId) : [],
      priority: null, scheduled: null, duration: '', repeat: null,
      editScope: 'all',
    }, { targetVaultId: vaultId })
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
    onVaultChange: vaultTarget.onVaultChange,
    pendingMove:   vaultTarget.pendingMove,
    onMoveConfirm: vaultTarget.onMoveConfirm,
    onMoveCancel:  vaultTarget.onMoveCancel,
    series,
    pendingLinks: { effectiveKey, pendingKeys, handleAdd: handleAddLink, handleRemove: handleRemoveLink },
    handleCreateList,
    saveMeta,
    handleOpenWikilink,
    handleSave,
    handleDelete,
    handleUnarchive,
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
