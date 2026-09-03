import { create } from 'zustand'
import type { StoreItem, Roots, Entries } from './types'
import type { LocalePrefs } from '@/model'
import type { VaultRef } from './vaultRef'
import type { OccColorBy } from './occView'
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
const COLOR_BY_KEY            = 'meridian_color_by'

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

/** One vault's slice of the store — the shape `getVaultLayer`/`setVaultLayer` trade in. */
export type VaultLayer = Entries

const EMPTY_LAYER: VaultLayer = new Map()

const EMPTY_KEYS: ReadonlySet<EntryKey> = new Set()

/**
 * Whether replacing `vaultId`'s slice of `prev` with `next` would change
 * nothing — the cheap guard in front of `setVaultListedKeys`' rebuild.
 *
 * Counts `vaultId`'s keys in `prev` rather than filtering them out, so the
 * whole check is one pass with no intermediate collection.
 */
function unchangedForVault(
  prev: ReadonlySet<EntryKey>, vaultId: string, next: ReadonlySet<EntryKey>,
): boolean {
  let mine = 0
  for (const key of prev) {
    if (keyVaultId(key) !== vaultId) continue
    mine++
    if (!next.has(key)) return false
  }
  return mine === next.size
}

/**
 * Replace `vaultId`'s entries with `next`, leaving every other vault's entries
 * at their existing position in the map.
 *
 * `next` lands where that vault's own entries currently start, not appended
 * after everyone else's — otherwise the vault being written would migrate to
 * the tail on every single write to it, which is the common case (an edit, a
 * reconcile). A vault with no entries yet — new, or currently empty — gets
 * `next` appended, same as where a newly-registered vault would land.
 * Positional stability matters because `hasSameStructure`
 * (model/expansionCache.ts) compares the derived `items` array by index: a
 * merge that reorders unrelated vaults on every write makes every entry look
 * changed, silently degrading the incremental expansion cache to a full
 * re-expansion.
 */
function spliceVaultEntries(entries: Entries, vaultId: string, next: Entries): Entries {
  const result: Entries = new Map()
  let inserted = false
  const insert = (): void => { for (const [k, e] of next) result.set(k, e) }
  for (const [key, entry] of entries) {
    if (keyVaultId(key) !== vaultId) { result.set(key, entry); continue }
    if (!inserted) { insert(); inserted = true }
  }
  if (!inserted) insert()
  return result
}

/** Partition the store's entries by vault. Every entry carries its vault in its `EntryKey`, so this is exact. */
function partitionByVault(entries: Entries): Map<string, VaultLayer> {
  const byVault = new Map<string, VaultLayer>()
  for (const [key, entry] of entries) {
    const vaultId = keyVaultId(key)
    let layer = byVault.get(vaultId)
    if (!layer) { layer = new Map(); byVault.set(vaultId, layer) }
    layer.set(key, entry)
  }
  return byVault
}

interface LayerPartitionMemo { entries: Entries; byVault: Map<string, VaultLayer> }
// A one-entry Map, matching fileOccurrenceMap's memo (fileOccurrence.ts) —
// `vaultLayer` is called from `getVaultLayer` (storeBridge.ts), which render
// paths may call, so it stays pure: same `entries` in, same partition out, by
// reference.
const LAYER_PARTITION_KEY = 'partition'
const layerPartitionMemo = new Map<typeof LAYER_PARTITION_KEY, LayerPartitionMemo>()

/**
 * A vault's slice of the store, memoized on `entries` identity.
 * Empty for a vault with no entries — including one that isn't registered at
 * all; nothing downstream needs to tell those two apart (see
 * `mergeChangedIntoStore`, storage/sync.ts, the one production reader).
 */
export function vaultLayer(entries: Entries, vaultId: string): VaultLayer {
  const prev = layerPartitionMemo.get(LAYER_PARTITION_KEY)
  const byVault = prev && prev.entries === entries
    ? prev.byVault
    : partitionByVault(entries)
  if (byVault !== prev?.byVault) layerPartitionMemo.set(LAYER_PARTITION_KEY, { entries, byVault })
  return byVault.get(vaultId) ?? EMPTY_LAYER
}

// ── DERIVED FLAT VIEWS ──────────────────────────────────────────────────────

/**
 * `entries` is the store's single stored form; `items` and `roots` are derived
 * from it — the flat shapes `expandRange`, the calendar and every view still
 * take, so reshaping the store changed none of their signatures.
 *
 * Derived **once per commit and stored**, not recomputed per read. A zustand
 * selector that rebuilt a fresh array on every call would return a new
 * reference to every `useStore(s => s.items)` subscriber on every unrelated
 * store write, which is both a render storm and a lie to the four caches below.
 *
 * Reference identity is load-bearing in four independent places, and value
 * equality is not enough for any of them:
 *
 * - `setData` reuses the backlink index when `roots === prevRoots`;
 * - `fileOccurrenceMap` memoizes on `entries`/`roots` identity, and its
 *   incremental path on `prevEntries.get(key) === entries.get(key)`;
 * - `computeExpansionCache` overlays only items failing `item === prev.items[i]`;
 * - `useAgendaSections` caches on top of that.
 *
 * Per-element identity comes for free: an untouched `Entry` hands back the very
 * same `root` object and the very same `StoreItem` objects it always held. The
 * *containers* are what need care, which is what `sameItems`/`sameRoots` below
 * are for — without them an occurrence-only edit would hand out a fresh `roots`
 * Map and rebuild the backlink index on every keystroke.
 */
export interface DerivedViews {
  items: StoreItem[]
  roots: Roots
}

/** Element-wise reference comparison — `next` was just built, so this is the only way to tell it apart from `prev`. */
function sameItems(prev: StoreItem[], next: StoreItem[]): boolean {
  if (prev.length !== next.length) return false
  return prev.every((item, i) => item === next[i])
}

function sameRoots(prev: Roots, next: Roots): boolean {
  if (prev.size !== next.size) return false
  for (const [key, root] of next) {
    if (prev.get(key) !== root) return false
  }
  return true
}

/**
 * Flatten `entries` into the two derived views, reusing `prev`'s containers
 * whenever the flattening came out reference-identical.
 *
 * The reuse is the point, not an optimization detail: `toggleDone` and
 * `excludeOccurrence` change an occurrence and nothing file-level, and the
 * caches downstream are entitled to notice that `roots` did not move.
 */
export function deriveViews(entries: Entries, prev: DerivedViews | null): DerivedViews {
  const items: StoreItem[] = []
  const roots: Roots = new Map()
  for (const [key, entry] of entries) {
    for (const item of entry.items) items.push(item)
    roots.set(key, entry.root)
  }
  return {
    items: prev && sameItems(prev.items, items) ? prev.items : items,
    roots: prev && sameRoots(prev.roots, roots) ? prev.roots : roots,
  }
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
  /**
   * The store's single stored form: every entry of every registered vault,
   * each one a `{ key, root, items }` object rather than two halves in two
   * unrelated collections. `vaultLayer` derives one vault's slice on demand.
   */
  entries: Entries
  /**
   * Derived from `entries`, recomputed once per commit — see `deriveViews`.
   * These are the flat shapes `expandRange`, the calendar and every view take;
   * they are stored rather than selected so their reference identity survives
   * unrelated writes.
   */
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
  /** Replace every entry atomically. The domain layer's commit path. */
  setData: (entries: Entries) => void
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
  /**
   * Every key each vault's backend *listed* on its last reconcile — including
   * files whose content has not been pulled into `entries` yet.
   *
   * `entries` answers "what have we read", which is not the same question as
   * "what slugs does this vault already own", and slug allocation needs the
   * second one. The gap between them is widest exactly when it matters most: a
   * vault that has not synced in a week has a store painted from a week-old
   * cache, so every file added elsewhere since looks like a free slug. A new
   * entry allocated onto one of those pushes as a create, the backend refuses
   * it (the path is not absent), and the divergence resolves as a conflict copy
   * between two notes that were never versions of each other.
   *
   * `statAll` already answers this on every cycle and used to be discarded once
   * `planReconcile` had read it. Keeping it costs one Set per vault and closes
   * the window from the listing's arrival — the first round trip of a cycle —
   * rather than from the last file being parsed.
   *
   * Consulted through `getSlugSnapshot` (storeBridge.ts), never read directly.
   */
  listedKeys: ReadonlySet<EntryKey>
  /** Replace one vault's contribution to `listedKeys`. A no-op when unchanged. */
  setVaultListedKeys: (vaultId: string, keys: ReadonlySet<EntryKey>) => void

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

  // ── Occurrence coloring ──────────────────────────────────────────
  /**
   * Which source picks an occurrence's color — its type/priority, or the
   * vault it came from. Explicit and sticky: nothing switches it on the
   * user's behalf (a vault gaining or losing a color changes what that vault
   * paints with, never which mode the app is in). A view question, so global.
   */
  colorBy:      OccColorBy
  loadColorBy:  () => void
  setColorBy:   (colorBy: OccColorBy) => void

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
  /**
   * Store `entries`, refresh the views derived from it, and refresh the derived
   * indexes. The single write path — every setter below goes through it, so the
   * derived views can never be stale with respect to `entries`.
   */
  function commitMerged(entries: Entries): void {
    const { items: prevItems, roots: prevRoots, backlinks: prevBacklinks } = get()
    const { items, roots } = deriveViews(entries, { items: prevItems, roots: prevRoots })
    // backlinks depend only on roots; reuse the prior index when roots is reference-stable.
    const backlinks = roots === prevRoots ? prevBacklinks : buildBacklinkIndex(roots)
    set({ entries, items, roots, backlinks })
    // Off the critical path on purpose — this is the expensive derived index,
    // and nothing painted at cold start reads it. Warming it during idle keeps
    // the editor/search consumers from paying for it on open either.
    warmFileOccurrenceMap(entries, roots)
  }

  return {
    entries: new Map(),
    items:  [],
    roots:  new Map(),
    backlinks: new Map(),

    setData: (entries) => { commitMerged(entries) },

    setVaultLayer: (vaultId, data) => {
      commitMerged(spliceVaultEntries(get().entries, vaultId, data))
      const layerItems = [...data.values()].flatMap(entry => entry.items)
      const migrated = migrateParticipantFilter(vaultId, layerItems, get().hiddenParticipants)
      if (migrated) set({ hiddenParticipants: migrated })
    },

    removeVaultLayer: (vaultId) => {
      // Before the early return below: a vault can hold listed keys with no
      // entries at all (its listing arrived, its content had not been pulled
      // yet), and those must not outlive it and go on reserving slugs.
      get().setVaultListedKeys(vaultId, EMPTY_KEYS)
      const { entries } = get()
      if (![...entries.keys()].some(key => keyVaultId(key) === vaultId)) return
      commitMerged(new Map([...entries].filter(([key]) => keyVaultId(key) !== vaultId)))
    },

    unreadableFiles: new Map(),
    setUnreadableFiles: (files) => set({ unreadableFiles: files }),

    listedKeys: EMPTY_KEYS,
    setVaultListedKeys: (vaultId, keys) => {
      const prev = get().listedKeys
      // Every cycle re-publishes the same listing for a vault nobody changed,
      // and a fresh Set reference would notify every store subscriber for it.
      // Comparing first is O(n) with no allocation, against an O(n) rebuild
      // plus a render pass.
      if (unchangedForVault(prev, vaultId, keys)) return
      const next = new Set<EntryKey>(keys)
      for (const key of prev) if (keyVaultId(key) !== vaultId) next.add(key)
      set({ listedKeys: next })
    },

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

    colorBy: 'type',
    loadColorBy: () => {
      const stored = readJSON<unknown>(COLOR_BY_KEY, null)
      set({ colorBy: stored === 'vault' ? 'vault' : 'type' })
    },
    setColorBy: (colorBy: OccColorBy) => {
      writeJSON(COLOR_BY_KEY, colorBy)
      set({ colorBy })
    },

    localePrefs: loadLocalePrefs(),
    setLocalePrefs: (prefs: Partial<LocalePrefs>) => {
      const next = { ...get().localePrefs, ...prefs }
      localStorage.setItem('meridian_locale_prefs', JSON.stringify(next))
      set({ localePrefs: next })
    },
  }
})
