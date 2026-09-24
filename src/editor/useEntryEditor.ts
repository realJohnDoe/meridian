import { useState, useEffect, useRef, useMemo } from 'react'
import { startOfToday } from 'date-fns'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { useStore } from '@/store'
import { storeView, entryFromOccurrence, saveNode, deleteNode, addItemLink, removeItemLink, archiveEntry, reportContested } from './save'
import type { Occurrence, EditScope } from '@/types'
import { fmtISO, seriesContext } from '@/model'
import { useToday } from '@/hooks'
import { newEntryRoute, keyRoute } from '@/entryRoute'
import { resolveWikilink } from '@/wikilinks'
import { keySlug } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { toggleOccDone } from '@/occurrenceActions'
import { getFom, getItems } from '@/storeBridge'
import { readVaultStringArray } from '@/lib/vaultStorage'
import { type EntryState, type ItemType, ENTRY_DEFAULT } from './state'
import { useEntryDialogs } from './useEntryDialogs'
import { usePendingLinks } from './usePendingLinks'
import { useAutoSave } from './useAutoSave'
import { useVaultTarget, initialTargetVault } from './useVaultTarget'
import { foldEdits, applyEdits, editedFields, contestedFields, dropScopedEdits, type Edits } from './edits'

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
  //
  // ── The form is derived, not stored ──────────────────────────────────────
  //
  // `view` is what the store says about this occurrence at this scope, and
  // `edits` is what the user has changed on top of it. The form is the two
  // laid together. Nothing here caches a field the user has not touched, so
  // there is no second copy of one to go stale — see `edits.ts` for the three
  // bugs that cost, and `state.ts`'s note on why `EntryState` survived as the
  // render-facing shape.
  //
  const [editScope, setEditScope] = useState<EditScope>(initialScope)
  const [edits, setEdits] = useState<Edits>({})

  /**
   * A brand-new entry's starting point. It has no store row to read, so unlike
   * every other view this one is a constant: seeded once from the route's
   * params and this vault's default participants, then only moved by `edits`.
   */
  const [newEntryView] = useState<EntryState>(() => {
    const target = initialTargetVault(!initialOcc, seed?.vault)
    const defaultParticipants = target
      ? readVaultStringArray('meridian_default_participants', target)
      : []
    const base = entryFromItem(null, initialScope, seed)
    const seeded = defaultParticipants.length > 0
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

  // Once a brand-new item's first save creates its file, this holds the resulting
  // occurrence so later commits in the same session upsert onto it (see commitEntry)
  // instead of calling applyNew again. Deliberately NOT surfaced as `entry.item` —
  // EntryEditor derives `bodyKey`/scope-row visibility/etc. from that field, and
  // flipping it mid-session would remount the CodeMirror body editor under the user.
  const createdItemRef = useRef<Occurrence | null>(null)

  const storeRoots = useStore(s => s.roots)
  const storeItems = useStore(s => s.items)

  /**
   * The store's answer for this occurrence, at this scope, right now.
   *
   * Recomputed whenever the store or the scope moves, which is what makes a
   * field the user has not touched *live* rather than a mount-time copy —
   * the job `useLiveReload` used to do by subscribing and writing the change
   * into two places at once.
   *
   * `initialOcc` is pinned for the session on purpose (see `createdItemRef`),
   * and that is safe here for the same reason it is safe in `applyScope`,
   * which this calls: ownership and metadata are re-read from `storeItems`,
   * so only the occurrence's *identity* comes from the pinned value.
   */
  /**
   * The occurrence a brand-new entry's first save created, resolved from state
   * rather than from `createdItemRef`, which a render may not read. Same row
   * either way; the ref exists for the imperative paths that need it within
   * the tick that created it, before this render happens.
   */
  const createdItem = useMemo(
    () => {
      void storeItems // re-resolve when the store moves, not only when the key lands
      return createdKey ? (getFom().get(createdKey) ?? null) : null
    },
    [createdKey, storeItems],
  )

  const view = useMemo(
    () => {
      const item = initialOcc ?? createdItem
      if (!item) return newEntryView
      const derived = storeView(item, editScope, storeItems)
      // A brand-new entry's created row backs the view, but is deliberately
      // not surfaced as `entry.item` — see `createdItemRef` above: EntryEditor
      // keys the CodeMirror body off that field, so filling it in mid-session
      // would remount the editor under the user.
      return initialOcc ? derived : { ...derived, item: null }
    },
    [initialOcc, createdItem, editScope, storeItems, newEntryView],
  )

  /**
   * The description CodeMirror and the store last agreed on — what it was
   * mounted with, then whatever each save writes.
   *
   * The one field the form does *not* re-derive. A CodeMirror document has a
   * cursor, a selection and an undo history in it, and replacing that under
   * the user is the disruption the editor's never-re-read rule exists to
   * prevent — "they weren't typing just now" does not make it safe. So the
   * form keeps showing what CodeMirror holds, whatever the store now says.
   *
   * Correctness does not depend on the adoption: an untouched description is
   * not in `edits`, so `widenEdits` leaves it at the store's value and the
   * other side's survives. The one case that is not enough — both sides typing
   * prose — is a genuine overlap, and `contestedFields` still sees it, because
   * it is measured against `view` (the real store) rather than against this.
   *
   * It advances on save rather than staying at the mount value because a save
   * is the moment the two *do* agree again — left behind, the next fold would
   * read the already-written description as a fresh edit.
   */
  const [bodyBase, setBodyBase] = useState(() => (initialOcc ? storeView(initialOcc, initialScope, getItems()).body : ''))

  /** What the fold and the form are built on: the view, minus that one field. */
  const formView = useMemo(() => ({ ...view, body: bodyBase }), [view, bodyBase])

  /** The form: the store's view with the user's edits laid over it. */
  const entry = useMemo(() => applyEdits(formView, edits), [formView, edits])

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

  // Always points to the latest form/view so timer callbacks don't close over
  // stale state.
  const entryRef = useRef(entry)
  useEffect(() => { entryRef.current = entry }, [entry])
  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])
  const formViewRef = useRef(formView)
  useEffect(() => { formViewRef.current = formView }, [formView])
  const editsRef = useRef(edits)
  useEffect(() => { editsRef.current = edits }, [edits])

  /**
   * Record what the caller just changed, rather than replacing the form with
   * it. The difference between what the form shows and what it is asked to
   * show is exactly the user's intent; everything else in `next` is whatever
   * the view happened to supply and must not be mistaken for an edit.
   *
   * Same `setEntry(next)` signature the call sites always had, so a component
   * that wants to change a field still just says so.
   */
  const setEntry = (update: EntryState | ((prev: EntryState) => EntryState)) => {
    const from = entryRef.current
    const next = typeof update === 'function' ? update(from) : update
    if (next.editScope !== from.editScope) setEditScope(next.editScope)
    const folded = foldEdits(editsRef.current, from, next, formViewRef.current)
    editsRef.current = folded
    entryRef.current = applyEdits(formViewRef.current, folded)
    setEdits(folded)
  }
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
    // Whatever the caller is proposing beyond what the form already shows is
    // itself an edit — an autosave's body, a dialog's field — so fold it in
    // before deciding what to write.
    const pending = foldEdits(editsRef.current, entryRef.current, next, formViewRef.current)
    const item = next.item ?? createdItemRef.current
    if (item) {
      // Say out loud that a race happened, before resolving it in the user's
      // favour by writing. Only reachable with a second writer: with one, the
      // store cannot have left `storeWas` behind the user's back.
      reportContested(contestedFields(pending, viewRef.current))
      const key = saveNode(item, next.editScope, next, { edits: editedFields(pending) })
      setTitleMissing(key === null)
      // No-op once `next.item` itself is set (usePendingLinks already flushes
      // immediately in that case) — but while item only lives in
      // createdItemRef, entry.item is still null, so pending "listed on" links
      // added after creation would otherwise never get flushed again.
      if (key) { clearEdits(next); flushLinksRef.current(keySlug(key)) }
      return key
    }
    if (!next.title) return null
    // No writable vault to create the file in (e.g. only the read-only Tutorial
    // vault is registered) — EntryEditor's "no vault to save to" banner already
    // explains this, so falling through to the titleMissing branch below would
    // tell the user their (present) title is the problem.
    if (!vaultId) return null
    const key = saveNode(null, next.editScope, next, { draftId, targetVaultId })
    if (key === null) { setTitleMissing(true); return null }
    setTitleMissing(false)
    flushLinksRef.current(keySlug(key))
    setCreatedKey(key)
    createdItemRef.current = getFom().get(key) ?? null
    // The edits are in the store now, so the view carries them and the set
    // starts empty again. Deliberately *after* `createdItemRef`, which is what
    // switches `view` off `newEntryView` and onto the store's own row — clear
    // it first and the form would fall back to the seed and blank the title
    // the save just wrote.
    clearEdits(next)
    return key
  }

  /**
   * Everything the user changed has landed, so the set starts empty and the
   * view speaks for every field again.
   *
   * The refs go first and synchronously, re-read from the store rather than
   * left at this render's values: a commit can be followed by another within
   * the same tick (a dialog confirm right after an autosave flush), long
   * before React re-renders — and for a brand-new entry the commit is also
   * what gives it a store row to derive from at all.
   */
  const clearEdits = (saved: EntryState) => {
    const item = initialOcc ?? createdItemRef.current
    const fresh = item ? storeView(item, saved.editScope, getItems()) : formViewRef.current
    editsRef.current = {}
    viewRef.current = fresh
    formViewRef.current = { ...fresh, body: saved.body }
    entryRef.current = formViewRef.current
    setBodyBase(saved.body)
    setEdits({})
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
    // No vault to save a brand-new entry to — same case commitEntry guards
    // above. There's nothing this save could do, and the (present) title isn't
    // the problem, so just leave rather than flagging titleMissing.
    if (!item && !vaultId) { goBack(); return }
    const pending = foldEdits(editsRef.current, entryRef.current, { ...entry, body }, formViewRef.current)
    reportContested(contestedFields(pending, viewRef.current))
    const key = saveNode(item, entry.editScope, { ...entry, body }, { draftId, targetVaultId, edits: editedFields(pending) })
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

  /**
   * Picking a scope says which occurrences the *next* edit covers. It is not
   * itself an edit, so it moves nothing but the scope: `view` re-derives
   * `scheduled`, `repeat` and `done` from the store for the newly chosen
   * scope, and whatever the user has actually typed rides along in `edits`
   * untouched.
   *
   * This used to be three coupled assignments and was wrong twice. Committing
   * here wrote the entry at the new scope with every field unchanged, which
   * for 'future' meant `applyFuture` splitting the series on the spot. Moving
   * the form without moving `baseRef` made the next save read the scope switch
   * as a second writer, so every repeat change warned "the repeat also changed
   * somewhere else" on a vault nobody else was writing to. And blanking `done`
   * for 'add' left the form with no way back to the real value, so a
   * there-and-back through "Add new occurrence" un-ticked a completed task on
   * the next ordinary save.
   *
   * All three were the same thing: state that had to be kept in step by hand.
   * A derived view has nothing to keep in step — 'add' shows `done: false`
   * because `entryFromOccurrence` says so at that scope, and the moment the
   * scope changes back it says something else.
   */
  const handleScopeChange = (scope: EditScope) => {
    if (!entry.item) return
    setEditScope(scope)
    const kept = dropScopedEdits(editsRef.current)
    editsRef.current = kept
    setEdits(kept)
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
