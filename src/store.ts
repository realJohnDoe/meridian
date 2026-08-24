import { create } from 'zustand'
import type { StoreItem, Roots } from './types'
import type { LocalePrefs } from '@/model'
import type { VaultRef } from './vaultRef'
import { warmFileOccurrenceMap, buildBacklinkIndex } from './fileOccurrence'
import { entryKey as makeEntryKey, isEntryKey, keyVaultId } from './fileIO'
import type { EntryKey } from './fileIO'
import { readVaultStringArray, writeVaultJSON, readVaultJSON, clearVaultKey } from '@/lib/vaultStorage'

/**
 * The "this occurrence has nobody on it" row in the people filter. A sentinel
 * rather than `''` so it can never collide with a participant whose name
 * trimmed to empty, and defined here rather than in `calendar/` because
 * `hiddenParticipants` — which stores it — lives in this file.
 * `@/calendar` re-exports it, which is where every existing caller reads it.
 */
export const NO_PARTICIPANT = '__no_participant__'

// ── Global (non-vault-scoped) localStorage keys ────────────────────────────
// Per-vault keys still go through lib/vaultStorage's `${prefix}_${vaultId}`
// convention; these three are genuinely cross-vault and so carry no vault
// suffix.
const FAVORITES_KEY           = 'meridian_favorites_all'
const HIDDEN_PARTICIPANTS_KEY = 'meridian_hidden_participants'
const HIDDEN_VAULTS_KEY       = 'meridian_hidden_vaults'
const DEFAULT_VAULT_KEY       = 'meridian_default_vault'
const SHOW_TASKS_KEY          = 'meridian_show_tasks_all'

// Legacy per-vault prefixes, read once during migration and then removed.
const LEGACY_FAVORITES_PREFIX  = 'meridian_favorites'
const LEGACY_PARTICIPANT_FILTER_PREFIX = 'meridian_participant_filter'
const LEGACY_SHOW_TASKS_PREFIX = 'meridian_show_tasks'

function detectLocalePrefs(): LocalePrefs {
  const hour12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' })
    .resolvedOptions().hour12 ?? false
  const locale = new Intl.Locale(navigator.language)
  const weekInfo = (locale as unknown as { getWeekInfo?: () => { firstDay?: number } }).getWeekInfo?.()
  const firstDayOfWeek = (weekInfo?.firstDay ?? 1) as 1 | 6 | 7
  return { hour12, firstDayOfWeek }
}

function loadLocalePrefs(): LocalePrefs {
  try {
    const raw = localStorage.getItem('meridian_locale_prefs')
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalePrefs>
      const detected = detectLocalePrefs()
      return {
        hour12: typeof parsed.hour12 === 'boolean' ? parsed.hour12 : detected.hour12,
        firstDayOfWeek: (parsed.firstDayOfWeek === 1 || parsed.firstDayOfWeek === 6 || parsed.firstDayOfWeek === 7)
          ? parsed.firstDayOfWeek : detected.firstDayOfWeek,
      }
    }
  } catch { /* ignore */ }
  return detectLocalePrefs()
}

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota / private mode */ }
}

// ── LAYERS ──────────────────────────────────────────────────────────────────

/** One vault's slice of the merged `items`/`roots` — the shape `getVaultLayer`/`setVaultLayer` trade in. */
export interface VaultLayer {
  items: StoreItem[]
  roots: Roots
}

const EMPTY_LAYER: VaultLayer = { items: [], roots: new Map() }

/**
 * Replace `vaultId`'s items with `next`, leaving every other vault's items at
 * their existing position in the array.
 *
 * `next` lands where that vault's own items currently start, not appended
 * after everyone else's — otherwise the vault being written would migrate to
 * the tail of the array on every single write to it, which is the common
 * case (an edit, a reconcile). A vault with no items yet — new, or currently
 * empty — gets `next` appended, same as where a newly-registered vault would
 * land. Positional stability matters because `hasSameStructure`
 * (model/expansionCache.ts) compares the merged array's entries by index: a
 * merge that reorders unrelated vaults on every write makes every entry look
 * changed, silently degrading the incremental expansion cache to a full
 * re-expansion.
 */
function spliceVaultItems(items: StoreItem[], vaultId: string, next: StoreItem[]): StoreItem[] {
  const result: StoreItem[] = []
  let inserted = false
  for (const item of items) {
    if (keyVaultId(item.entryKey) !== vaultId) { result.push(item); continue }
    if (!inserted) { result.push(...next); inserted = true }
  }
  if (!inserted) result.push(...next)
  return result
}

/** Partition a merged `items`/`roots` pair by vault. Every entry carries its vault in its `EntryKey`, so this is exact. */
function partitionByVault(items: StoreItem[], roots: Roots): Map<string, VaultLayer> {
  const byVault = new Map<string, VaultLayer>()
  const bucket = (vaultId: string): VaultLayer => {
    let layer = byVault.get(vaultId)
    if (!layer) { layer = { items: [], roots: new Map() }; byVault.set(vaultId, layer) }
    return layer
  }
  for (const item of items) bucket(keyVaultId(item.entryKey)).items.push(item)
  for (const [key, meta] of roots) bucket(keyVaultId(key)).roots.set(key, meta)
  return byVault
}

interface LayerPartitionMemo { items: StoreItem[]; roots: Roots; byVault: Map<string, VaultLayer> }
// A one-entry Map, matching fileOccurrenceMap's memo (fileOccurrence.ts) —
// `vaultLayer` is called from `getVaultLayer` (storeBridge.ts), which render
// paths may call, so it stays pure: same `items`/`roots` in, same partition
// out, by reference.
const LAYER_PARTITION_KEY = 'partition'
const layerPartitionMemo = new Map<typeof LAYER_PARTITION_KEY, LayerPartitionMemo>()

/**
 * A vault's slice of the merged store, memoized on `items`/`roots` identity.
 * Empty for a vault with no entries — including one that isn't registered at
 * all; nothing downstream needs to tell those two apart (see
 * `mergeChangedIntoStore`, storage/sync.ts, the one production reader).
 */
export function vaultLayer(items: StoreItem[], roots: Roots, vaultId: string): VaultLayer {
  const prev = layerPartitionMemo.get(LAYER_PARTITION_KEY)
  const byVault = prev && prev.items === items && prev.roots === roots
    ? prev.byVault
    : partitionByVault(items, roots)
  if (byVault !== prev?.byVault) layerPartitionMemo.set(LAYER_PARTITION_KEY, { items, roots, byVault })
  return byVault.get(vaultId) ?? EMPTY_LAYER
}

// ── PER-VAULT SYNC STATUS ───────────────────────────────────────────────────

/**
 * Why a vault needs a user action before it can sync cleanly again.
 * `fs-permission` is a local vault waiting on a filesystem-permission
 * gesture; the other three are GitHub failures classified by
 * `storage/failureKind.ts`'s `FailureKind` (`auth` renamed to `reauth` here
 * since it names the fix, not the cause).
 */
export type AttentionKind = 'fs-permission' | 'reauth' | 'access' | 'config'

export interface VaultAttention {
  kind:    AttentionKind
  message: string
}

/**
 * What `SyncButton` shows for one vault. Written by `storage/sync.ts` (the
 * first five fields, plus `needsAttention` on an actionable sync failure) and
 * by `storage/vaultRegistry.ts` (`needsAttention` on mount) — one map rather
 * than two so a row renders from a single lookup.
 */
export interface VaultSyncStatus {
  dirtyCount:   number
  error:        string | null
  offline:      boolean
  inProgress:   boolean
  lastSyncedAt: number | null
  /** Informational, not an error — the vault's backend doesn't accept writes. */
  readOnly:     boolean
  /** Set when the vault needs a user action to sync again; null otherwise. */
  needsAttention: VaultAttention | null
}

export const emptySyncStatus = (): VaultSyncStatus => ({
  dirtyCount: 0, error: null, offline: false, inProgress: false,
  lastSyncedAt: null, readOnly: false, needsAttention: null,
})

interface MeridianStore {
  // ── Data ────────────────────────────────────────────────────────
  /** The merge of every registered vault's content. `vaultLayer` derives one vault's slice from this on demand. */
  items: StoreItem[]
  roots: Roots
  /**
   * Derived: target EntryKey → the EntryKeys that link to it. Recomputed on
   * every setData, which is affordable (~1 ms on a 300-file vault) and
   * necessary — AgendaRow reads it, so it is on the first-paint path.
   *
   * Its sibling index, the EntryKey → representative Occurrence map, is
   * deliberately *not* a store field: it costs ~240 ms to build and no
   * cold-start view reads it. See `fileOccurrenceMap` in fileOccurrence.ts and
   * the `useFileOccurrenceMap` hook.
   */
  backlinks: Map<EntryKey, EntryKey[]>
  /** Set the merged items and roots together atomically. The domain layer's commit path. */
  setData: (data: { items: StoreItem[]; roots: Roots }) => void
  /** Replace one registered vault's slice of the merge. The storage layer's path. */
  setVaultLayer: (vaultId: string, data: VaultLayer) => void
  /** Drop a vault's content entirely (unregistering it). */
  removeVaultLayer: (vaultId: string) => void
  /**
   * Files that failed to parse on the last load or reconcile, keyed by
   * EntryKey. Deliberately kept out of `roots` — an unparseable file has no
   * FileMetadata to offer, and giving it a placeholder root would make it
   * look like a normal (if empty) entry to wikilink resolution, search, and
   * `applyNew`'s collision check. Consulted by `saveNode` (src/editor/save.ts)
   * so a new entry can never silently overwrite a file that couldn't be read.
   */
  unreadableFiles: Map<EntryKey, { path: string; message: string }>
  setUnreadableFiles: (files: Map<EntryKey, { path: string; message: string }>) => void

  // ── Vaults ──────────────────────────────────────────────────────
  /** Every registered vault. Registered *is* mounted: each one syncs. */
  vaults: VaultRef[]
  /**
   * Where new entries go unless overridden per entry. Always a writable,
   * registered vault (or null before any is registered). Replaces the old
   * `activeVaultId`, which conflated this with "what's loaded", "what syncs"
   * and "whose prefs are live" — all three of which are now per-vault.
   */
  defaultVaultId: string | null
  setDefaultVaultId: (id: string | null) => void

  // ── Sync status ─────────────────────────────────────────────────
  /** Per-vault sync status. `SyncButton` aggregates for its icon, lists rows in its popover. */
  syncByVault: Map<string, VaultSyncStatus>
  setVaultSync:    (vaultId: string, patch: Partial<VaultSyncStatus>) => void
  removeVaultSync: (vaultId: string) => void

  // ── Vault loading ─────────────────────────────────────────────────
  /**
   * True while there is nothing to show yet. Cleared as soon as the vaults'
   * cached content is painted (which happens before any network work), so a
   * previously-loaded vault never sits behind a skeleton waiting on a sync.
   * Only stays true through activation when every cache was empty.
   */
  vaultLoading: boolean
  /**
   * Non-null while a backend's readAll() is reporting progress on a bulk load
   * (e.g. connecting a new GitHub vault). Backends that don't report progress
   * (local, example, or GraphQL fallback legs) simply never set this.
   */
  vaultLoadProgress: { loaded: number; total: number } | null

  // ── Favorites ────────────────────────────────────────────────────
  /**
   * Ordered EntryKeys across *every* registered vault. Flat rather than
   * per-vault because the sidebar's Favorites list spans all of them at once —
   * and the key already carries the vault, so nothing is lost by not
   * partitioning the storage.
   */
  favorites:        EntryKey[]
  loadFavorites:    (vaultIds: string[]) => void
  toggleFavorite:   (key: EntryKey) => void
  reorderFavorites: (fromIdx: number, toIdx: number) => void
  /**
   * Follow an entry that changed identity — today only a cross-vault move.
   * Keeps its position in the list; a no-op when it wasn't a favourite.
   */
  replaceFavorite:  (fromKey: EntryKey, toKey: EntryKey) => void

  // ── Default participants ──────────────────────────────────────────
  /**
   * Per-vault participant strings seeded into new entries, for `focusedVaultId`.
   * The one pref still loaded lazily, one vault at a time: it is only ever
   * consulted for a single vault (the new entry's target, or whichever vault
   * Settings has open).
   */
  defaultParticipants:     string[]
  /** Which vault `defaultParticipants` currently holds, so a stale read is detectable. */
  defaultParticipantsVaultId: string | null
  loadDefaultParticipants: (vaultId: string) => void
  setDefaultParticipants:  (vaultId: string, participants: string[]) => void

  // ── View filter ───────────────────────────────────────────────────
  /**
   * Filter state is "hidden", not "shown", throughout — so a newly registered
   * vault, and a newly appearing attendee, are visible by default rather than
   * silently filtered out. This inverts the pre-multi-vault `participantFilter`
   * semantics (empty = show all, checked = narrow to those); see
   * `migrateParticipantFilter` for the one-time conversion.
   */
  hiddenVaultIds:     string[]
  /** vaultId → hidden participant names in that vault. `NO_PARTICIPANT` = the no-people row. */
  hiddenParticipants: Record<string, string[]>
  loadViewFilter:       () => void
  toggleVaultHidden:    (vaultId: string) => void
  toggleParticipantHidden: (vaultId: string, name: string) => void
  /** Un-hide every person in one vault (but leaves the vault's own
   *  hidden/shown state untouched). This is what clicking a `some`
   *  (indeterminate) vault checkbox does — it never hides the vault itself. */
  clearVaultParticipants: (vaultId: string) => void
  /** Un-hide everything, in every vault. */
  clearViewFilter:      () => void

  // ── Tasks visibility ─────────────────────────────────────────────
  /** Whether tasks are shown in calendar views. A view question, so global. */
  showTasks:       boolean
  loadShowTasks:   (vaultIds: string[]) => void
  toggleShowTasks: () => void

  // ── Locale preferences ───────────────────────────────────────────
  /** Auto-detected from browser locale; overridable by the user. Stored in localStorage (global, not vault-scoped). */
  localePrefs:    LocalePrefs
  setLocalePrefs: (prefs: Partial<LocalePrefs>) => void
}

/**
 * Read favourites, upgrading anything an older build wrote.
 *
 * Two upgrades stack here. Pre-`EntryKey` builds stored bare slugs under a
 * per-vault key; the PR-1 build stored `EntryKey`s under that same per-vault
 * key. Both are read from `${LEGACY_FAVORITES_PREFIX}_${vaultId}` and folded
 * into the single flat list, with a bare slug qualified by the vault whose key
 * it was found under — exact, not a guess, since that key *is* that vault's.
 *
 * The legacy keys are removed once folded in, so this runs at most once per
 * vault. If the flat key already exists, the legacy keys are still swept: a
 * vault registered after the first migration brings its own.
 */
function readFavorites(vaultIds: string[]): EntryKey[] {
  const flat = readJSON<unknown>(FAVORITES_KEY, null)
  const merged: EntryKey[] = Array.isArray(flat)
    ? flat.filter((v): v is EntryKey => typeof v === 'string' && isEntryKey(v))
    : []

  let changed = false
  for (const vaultId of vaultIds) {
    const legacy = readVaultStringArray(LEGACY_FAVORITES_PREFIX, vaultId)
    if (legacy.length === 0) {
      // Still clear the key so an empty legacy list can't be re-swept forever.
      clearVaultKey(LEGACY_FAVORITES_PREFIX, vaultId)
      continue
    }
    for (const v of legacy) {
      const key = isEntryKey(v) ? v : makeEntryKey(vaultId, v)
      if (!merged.includes(key)) merged.push(key)
    }
    clearVaultKey(LEGACY_FAVORITES_PREFIX, vaultId)
    changed = true
  }
  if (changed || flat === null) writeJSON(FAVORITES_KEY, merged)
  return merged
}

/**
 * Convert one vault's old inclusive `participantFilter` into the new
 * "hidden" semantics, once, against the participant set known right now.
 *
 * `hidden = allParticipants − oldFilter` when the old value was non-empty
 * (an empty old filter meant "show all", which is `[]` hidden). Best-effort by
 * nature: a participant who only appears in a file loaded later was never in
 * the old filter's world either, and lands visible — the safe direction.
 *
 * Called from `setVaultLayer`, which is the first moment this vault's
 * participants are knowable. Idempotent: the legacy key is deleted, so a later
 * layer write for the same vault is a no-op.
 */
const _filterMigrationChecked = new Set<string>()

function migrateParticipantFilter(
  vaultId: string, items: StoreItem[], current: Record<string, string[]>,
): Record<string, string[]> | null {
  // `setVaultLayer` is on the reconcile path — every sync cycle writes a layer —
  // so this must not cost a localStorage read per vault per cycle. One check
  // per vault per session is enough: the legacy key is deleted below, and
  // nothing recreates it.
  if (_filterMigrationChecked.has(vaultId)) return null
  _filterMigrationChecked.add(vaultId)
  const legacy = readVaultJSON<string[] | null>(LEGACY_PARTICIPANT_FILTER_PREFIX, vaultId, null)
  if (legacy === null) return null
  clearVaultKey(LEGACY_PARTICIPANT_FILTER_PREFIX, vaultId)
  if (!Array.isArray(legacy) || legacy.length === 0) return null

  const all = new Set<string>([NO_PARTICIPANT])
  for (const item of items) {
    for (const p of item.metadata.participants) {
      const trimmed = p.trim()
      if (trimmed) all.add(trimmed)
    }
  }
  const hidden = [...all].filter(p => !legacy.includes(p))
  const next = { ...current, [vaultId]: hidden }
  writeJSON(HIDDEN_PARTICIPANTS_KEY, next)
  return next
}

export const useStore = create<MeridianStore>((set, get) => {
  /** Store a merged items/roots pair and refresh the derived indexes. Shared by every write path below. */
  function commitMerged(items: StoreItem[], roots: Roots, backlinks: Map<EntryKey, EntryKey[]>): void {
    set({ items, roots, backlinks })
    // Off the critical path on purpose — this is the expensive derived index,
    // and nothing painted at cold start reads it. Warming it during idle keeps
    // the editor/search consumers from paying for it on open either.
    warmFileOccurrenceMap(items, roots)
  }

  return {
    items:  [],
    roots:  new Map(),
    backlinks: new Map(),

    setData: ({ items, roots }) => {
      const { roots: prevRoots, backlinks: prevBacklinks } = get()
      // backlinks depend only on roots; reuse the prior index when roots is reference-stable.
      const backlinks = roots === prevRoots ? prevBacklinks : buildBacklinkIndex(roots)
      // The merged arrays are stored exactly as handed over — callers rely on
      // that reference identity for their own memo deps.
      commitMerged(items, roots, backlinks)
    },

    setVaultLayer: (vaultId, data) => {
      const { items, roots } = get()
      const nextItems = spliceVaultItems(items, vaultId, data.items)
      const keptRoots: Roots = new Map([...roots].filter(([key]) => keyVaultId(key) !== vaultId))
      const nextRoots: Roots = new Map([...keptRoots, ...data.roots])
      commitMerged(nextItems, nextRoots, buildBacklinkIndex(nextRoots))
      const migrated = migrateParticipantFilter(vaultId, data.items, get().hiddenParticipants)
      if (migrated) set({ hiddenParticipants: migrated })
    },

    removeVaultLayer: (vaultId) => {
      const { items, roots } = get()
      const hasItems = items.some(item => keyVaultId(item.entryKey) === vaultId)
      const hasRoots = [...roots.keys()].some(key => keyVaultId(key) === vaultId)
      if (!hasItems && !hasRoots) return
      const nextItems = items.filter(item => keyVaultId(item.entryKey) !== vaultId)
      const nextRoots: Roots = new Map([...roots].filter(([key]) => keyVaultId(key) !== vaultId))
      commitMerged(nextItems, nextRoots, buildBacklinkIndex(nextRoots))
    },

    unreadableFiles: new Map(),
    setUnreadableFiles: (files) => set({ unreadableFiles: files }),

    vaults:         [],
    defaultVaultId: readJSON<string | null>(DEFAULT_VAULT_KEY, null),
    setDefaultVaultId: (id) => {
      writeJSON(DEFAULT_VAULT_KEY, id)
      set({ defaultVaultId: id })
    },

    syncByVault: new Map(),
    setVaultSync: (vaultId, patch) => {
      const next = new Map(get().syncByVault)
      next.set(vaultId, { ...(next.get(vaultId) ?? emptySyncStatus()), ...patch })
      set({ syncByVault: next })
    },
    removeVaultSync: (vaultId) => {
      const next = new Map(get().syncByVault)
      if (!next.delete(vaultId)) return
      set({ syncByVault: next })
    },

    vaultLoading: true,
    vaultLoadProgress: null,

    favorites: [],
    loadFavorites: (vaultIds) => { set({ favorites: readFavorites(vaultIds) }) },
    toggleFavorite: (key: EntryKey) => {
      const { favorites } = get()
      const next = favorites.includes(key)
        ? favorites.filter(k => k !== key)
        : [...favorites, key]
      writeJSON(FAVORITES_KEY, next)
      set({ favorites: next })
    },
    reorderFavorites: (fromIdx: number, toIdx: number) => {
      const { favorites } = get()
      if (toIdx < 0 || toIdx >= favorites.length) return
      // fromIdx needs the same bounds check: an out-of-range splice() returns
      // [] and would otherwise insert `undefined` into the favorites list.
      if (fromIdx < 0 || fromIdx >= favorites.length) return
      const next: EntryKey[] = [...favorites]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item!)
      writeJSON(FAVORITES_KEY, next)
      set({ favorites: next })
    },

    replaceFavorite: (fromKey: EntryKey, toKey: EntryKey) => {
      const { favorites } = get()
      const idx = favorites.indexOf(fromKey)
      if (idx === -1) return
      const next: EntryKey[] = [...favorites]
      next[idx] = toKey
      writeJSON(FAVORITES_KEY, next)
      set({ favorites: next })
    },

    defaultParticipants: [],
    defaultParticipantsVaultId: null,
    loadDefaultParticipants: (vaultId: string) => set({
      defaultParticipants: readVaultStringArray('meridian_default_participants', vaultId),
      defaultParticipantsVaultId: vaultId,
    }),
    setDefaultParticipants: (vaultId: string, participants: string[]) => {
      writeVaultJSON('meridian_default_participants', vaultId, participants)
      // Only mirror into the store when it is this vault's values on show —
      // Settings can edit a vault other than the one a new entry would target.
      if (get().defaultParticipantsVaultId === vaultId) set({ defaultParticipants: participants })
    },

    hiddenVaultIds:     [],
    hiddenParticipants: {},
    loadViewFilter: () => set({
      hiddenVaultIds: readJSON<string[]>(HIDDEN_VAULTS_KEY, []).filter(v => typeof v === 'string'),
      hiddenParticipants: readJSON<Record<string, string[]>>(HIDDEN_PARTICIPANTS_KEY, {}),
    }),
    toggleVaultHidden: (vaultId: string) => {
      const { hiddenVaultIds } = get()
      const next = hiddenVaultIds.includes(vaultId)
        ? hiddenVaultIds.filter(v => v !== vaultId)
        : [...hiddenVaultIds, vaultId]
      writeJSON(HIDDEN_VAULTS_KEY, next)
      set({ hiddenVaultIds: next })
    },
    toggleParticipantHidden: (vaultId: string, name: string) => {
      const { hiddenParticipants } = get()
      const cur  = hiddenParticipants[vaultId] ?? []
      const list = cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]
      // Replaced, never mutated: `useCalendarFilter` puts this object in a
      // useCallback dep list that `agendaSections` caches by reference.
      const next = { ...hiddenParticipants, [vaultId]: list }
      writeJSON(HIDDEN_PARTICIPANTS_KEY, next)
      set({ hiddenParticipants: next })
    },
    clearVaultParticipants: (vaultId: string) => {
      const { hiddenParticipants } = get()
      if ((hiddenParticipants[vaultId] ?? []).length === 0) return
      const next = { ...hiddenParticipants, [vaultId]: [] }
      writeJSON(HIDDEN_PARTICIPANTS_KEY, next)
      set({ hiddenParticipants: next })
    },
    clearViewFilter: () => {
      writeJSON(HIDDEN_VAULTS_KEY, [])
      writeJSON(HIDDEN_PARTICIPANTS_KEY, {})
      set({ hiddenVaultIds: [], hiddenParticipants: {} })
    },

    showTasks: true,
    loadShowTasks: (vaultIds) => {
      const global = readJSON<boolean | null>(SHOW_TASKS_KEY, null)
      if (typeof global === 'boolean') { set({ showTasks: global }); return }
      // No global value yet: adopt the first per-vault value an older build
      // left behind, so an explicit "hide tasks" survives the upgrade.
      let value = true
      for (const id of vaultIds) {
        const legacy = readVaultJSON<boolean | null>(LEGACY_SHOW_TASKS_PREFIX, id, null)
        if (typeof legacy === 'boolean') { value = legacy; break }
      }
      for (const id of vaultIds) clearVaultKey(LEGACY_SHOW_TASKS_PREFIX, id)
      writeJSON(SHOW_TASKS_KEY, value)
      set({ showTasks: value })
    },
    toggleShowTasks: () => {
      const next = !get().showTasks
      writeJSON(SHOW_TASKS_KEY, next)
      set({ showTasks: next })
    },

    localePrefs: loadLocalePrefs(),
    setLocalePrefs: (prefs: Partial<LocalePrefs>) => {
      const next = { ...get().localePrefs, ...prefs }
      localStorage.setItem('meridian_locale_prefs', JSON.stringify(next))
      set({ localePrefs: next })
    },
  }
})
