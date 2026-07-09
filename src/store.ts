import { create } from 'zustand'
import type { StoreItem, Roots, Occurrence, LocalePrefs, VaultRef } from './types'
import { clearOccIdCache } from '@/model'
import { updateFileOccurrenceMap } from './fileOccurrence'
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
  /** Set items and roots together atomically. */
  setData: (data: { items: StoreItem[]; roots: Roots }) => void

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
  /** Timestamp (ms) of the last successful sync, or null if never synced this session. */
  lastSyncedAt: number | null

  // ── Vault loading ─────────────────────────────────────────────────
  /** True from app start until restoreVaults() settles — distinguishes "loading" from "empty". */
  vaultLoading: boolean

  // ── Agenda scroll ────────────────────────────────────────────────
  /** When true, AgendaPage will scroll to today once then clear this flag. */
  scrollToTodayOnce: boolean
  /** ISO date string of the topmost visible day in the agenda view. */
  agendaTopDate: string | null

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
    load: (vaultId: string) => set({ [field]: readVaultStringArray(keyPrefix, vaultId) } as Partial<MeridianStore>),
    persist: (value: string[]) => {
      const { activeVaultId } = get()
      if (activeVaultId) writeVaultJSON(keyPrefix, activeVaultId, value)
      set({ [field]: value } as Partial<MeridianStore>)
    },
  }
}

/** Persists a vault-scoped boolean field to localStorage on every write, keyed by the active vault. */
function persistedBoolField(keyPrefix: string, field: keyof MeridianStore, defaultValue: boolean, set: Setter, get: Getter) {
  return {
    load: (vaultId: string) => set({ [field]: readVaultJSON(keyPrefix, vaultId, defaultValue) } as Partial<MeridianStore>),
    persist: (value: boolean) => {
      const { activeVaultId } = get()
      if (activeVaultId) writeVaultJSON(keyPrefix, activeVaultId, value)
      set({ [field]: value } as Partial<MeridianStore>)
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
    setData: ({ items, roots }) => {
      clearOccIdCache()
      const { items: prevItems, roots: prevRoots, fom: prevFom } = get()
      set({ items, roots, fom: updateFileOccurrenceMap(prevFom, prevItems, prevRoots, items, roots) })
    },

    vaults:              [],
    activeVaultId:       null,
    pendingDirReconnect: null,

    syncDirtyCount: 0,
    syncError:      null,
    syncOffline:    false,
    lastSyncedAt:   null,

    vaultLoading: true,

    scrollToTodayOnce: false,
    agendaTopDate:     null,

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
      const next = [...favorites]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
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
