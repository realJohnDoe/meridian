import { create } from 'zustand'
import type { StoreItem, Roots, Occurrence, LocalePrefs, VaultRef } from './types'
import { weekStartsOn } from '@/model'
import { updateFileOccurrenceMap, buildBacklinkIndex } from './fileOccurrence'
import { readVaultStringArray, writeVaultJSON, readVaultJSON } from '@/lib/vaultStorage'

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

interface MeridianStore {
  // ── Data ────────────────────────────────────────────────────────
  items: StoreItem[]
  roots: Roots
  /** Derived: one representative Occurrence per file slug. Recomputed on every setData. */
  fom: Map<string, Occurrence>
  /** Derived: targetSlug → sourceSlugs that link to it. Recomputed on every setData. */
  backlinks: Map<string, string[]>
  /** Set items and roots together atomically. */
  setData: (data: { items: StoreItem[]; roots: Roots }) => void
  /**
   * Files that failed to parse on the last load or reconcile, keyed by
   * fileSlug. Deliberately kept out of `roots` — an unparseable file has no
   * FileMetadata to offer, and giving it a placeholder root would make it
   * look like a normal (if empty) entry to wikilink resolution, search, and
   * `applyNew`'s collision check. Consulted by `saveNode` (src/editor/save.ts)
   * so a new entry can never silently overwrite a file that couldn't be read.
   */
  unreadableFiles: Map<string, { path: string; message: string }>
  setUnreadableFiles: (files: Map<string, { path: string; message: string }>) => void

  // ── Vaults ──────────────────────────────────────────────────────
  vaults:        VaultRef[]
  activeVaultId: string | null
  /** Non-null when the active local vault needs a user gesture to re-grant FS permission. */
  pendingDirReconnect: string | null

  // ── Sync status ─────────────────────────────────────────────────
  /** Number of dirty (unsynced) files in the IndexedDB cache. */
  syncDirtyCount: number
  /** Non-null when the vault is read-only or a sync attempt failed with an actionable error. */
  syncError: string | null
  /** True when the last sync attempt failed due to a transient network/offline error. */
  syncOffline: boolean
  /**
   * True while a sync cycle is running. Distinct from `vaultLoading`: content
   * is already on screen, it's just being refreshed in the background.
   */
  syncInProgress: boolean
  /** Timestamp (ms) of the last successful sync, or null if never synced this session. */
  lastSyncedAt: number | null

  // ── Vault loading ─────────────────────────────────────────────────
  /**
   * True while there is nothing to show yet. Cleared as soon as the vault's
   * cached content is painted (which happens before any network work), so a
   * previously-loaded vault never sits behind a skeleton waiting on a sync.
   * Only stays true through activation when the cache was empty.
   */
  vaultLoading: boolean
  /**
   * Non-null while a backend's readAll() is reporting progress on a bulk load
   * (e.g. connecting a new GitHub vault). Backends that don't report progress
   * (local, example, or GraphQL fallback legs) simply never set this.
   */
  vaultLoadProgress: { loaded: number; total: number } | null

  // ── Favorites ────────────────────────────────────────────────────
  /** Ordered fileSlug array for the active vault. Stored in localStorage, never written to files. */
  favorites:        string[]
  loadFavorites:    (vaultId: string) => void
  toggleFavorite:   (fileSlug: string) => void
  reorderFavorites: (fromIdx: number, toIdx: number) => void

  // ── Default participants ──────────────────────────────────────────
  /** Per-vault participant strings seeded into new entries. Stored in localStorage. */
  defaultParticipants:     string[]
  loadDefaultParticipants: (vaultId: string) => void
  setDefaultParticipants:  (participants: string[]) => void

  // ── Participant filter ────────────────────────────────────────────
  /** Checked participant names for sidebar filter. Empty = no filter (show all). */
  participantFilter:        string[]
  loadParticipantFilter:    (vaultId: string) => void
  toggleParticipantFilter:  (name: string) => void
  clearParticipantFilter:   () => void

  // ── Tasks visibility ─────────────────────────────────────────────
  /** Whether tasks are shown in calendar views. */
  showTasks:       boolean
  loadShowTasks:   (vaultId: string) => void
  toggleShowTasks: () => void

  // ── Locale preferences ───────────────────────────────────────────
  /** Auto-detected from browser locale; overridable by the user. Stored in localStorage (global, not vault-scoped). */
  localePrefs:    LocalePrefs
  setLocalePrefs: (prefs: Partial<LocalePrefs>) => void
}

type Setter = (partial: Partial<MeridianStore>) => void
type Getter = () => MeridianStore

/** Persists a vault-scoped string-array field to localStorage on every write, keyed by the active vault. */
function persistedArrayField(keyPrefix: string, field: keyof MeridianStore, set: Setter, get: Getter) {
  return {
    load: (vaultId: string) => set({ [field]: readVaultStringArray(keyPrefix, vaultId) }),
    persist: (value: string[]) => {
      const { activeVaultId } = get()
      if (activeVaultId) writeVaultJSON(keyPrefix, activeVaultId, value)
      set({ [field]: value })
    },
  }
}

/** Persists a vault-scoped boolean field to localStorage on every write, keyed by the active vault. */
function persistedBoolField(keyPrefix: string, field: keyof MeridianStore, defaultValue: boolean, set: Setter, get: Getter) {
  return {
    load: (vaultId: string) => set({ [field]: readVaultJSON(keyPrefix, vaultId, defaultValue) }),
    persist: (value: boolean) => {
      const { activeVaultId } = get()
      if (activeVaultId) writeVaultJSON(keyPrefix, activeVaultId, value)
      set({ [field]: value })
    },
  }
}

export const useStore = create<MeridianStore>((set, get) => {
  const favoritesField = persistedArrayField('meridian_favorites', 'favorites', set, get)
  const defaultParticipantsField = persistedArrayField('meridian_default_participants', 'defaultParticipants', set, get)
  const participantFilterField = persistedArrayField('meridian_participant_filter', 'participantFilter', set, get)
  const showTasksField = persistedBoolField('meridian_show_tasks', 'showTasks', true, set, get)

  return {
    items: [],
    roots: new Map(),
    fom: new Map(),
    backlinks: new Map(),
    setData: ({ items, roots }) => {
      const { items: prevItems, roots: prevRoots, fom: prevFom, backlinks: prevBacklinks, localePrefs } = get()
      const weekStart = weekStartsOn(localePrefs)
      // backlinks depend only on roots; reuse the prior index when roots is reference-stable.
      const backlinks = roots === prevRoots ? prevBacklinks : buildBacklinkIndex(roots)
      set({ items, roots, fom: updateFileOccurrenceMap(prevFom, prevItems, prevRoots, items, roots, weekStart), backlinks })
    },

    unreadableFiles: new Map(),
    setUnreadableFiles: (files) => set({ unreadableFiles: files }),

    vaults:              [],
    activeVaultId:       null,
    pendingDirReconnect: null,

    syncDirtyCount: 0,
    syncError:      null,
    syncOffline:    false,
    syncInProgress: false,
    lastSyncedAt:   null,

    vaultLoading: true,
    vaultLoadProgress: null,

    favorites: [],
    loadFavorites: favoritesField.load,
    toggleFavorite: (fileSlug: string) => {
      const { favorites } = get()
      const next = favorites.includes(fileSlug)
        ? favorites.filter(s => s !== fileSlug)
        : [...favorites, fileSlug]
      favoritesField.persist(next)
    },
    reorderFavorites: (fromIdx: number, toIdx: number) => {
      const { favorites } = get()
      if (toIdx < 0 || toIdx >= favorites.length) return
      // fromIdx needs the same bounds check: an out-of-range splice() returns
      // [] and would otherwise insert `undefined` into the favorites list.
      if (fromIdx < 0 || fromIdx >= favorites.length) return
      const next = [...favorites]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item!)
      favoritesField.persist(next)
    },

    defaultParticipants: [],
    loadDefaultParticipants: defaultParticipantsField.load,
    setDefaultParticipants: defaultParticipantsField.persist,

    participantFilter: [],
    loadParticipantFilter: participantFilterField.load,
    toggleParticipantFilter: (name: string) => {
      const { participantFilter } = get()
      const next = participantFilter.includes(name)
        ? participantFilter.filter(s => s !== name)
        : [...participantFilter, name]
      participantFilterField.persist(next)
    },
    clearParticipantFilter: () => participantFilterField.persist([]),

    showTasks: true,
    loadShowTasks: showTasksField.load,
    toggleShowTasks: () => showTasksField.persist(!get().showTasks),

    localePrefs: loadLocalePrefs(),
    setLocalePrefs: (prefs: Partial<LocalePrefs>) => {
      const next = { ...get().localePrefs, ...prefs }
      localStorage.setItem('meridian_locale_prefs', JSON.stringify(next))
      set({ localePrefs: next })
    },
  }
})
