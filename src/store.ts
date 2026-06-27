import { create } from 'zustand'
import type { StoreItem, Roots, Occurrence } from './types'
import type { VaultRef } from '@/storage'
import { clearOccIdCache } from '@/model'
import { updateFileOccurrenceMap } from './fileOccurrence'

export type LocalePrefs = {
  hour12: boolean
  firstDayOfWeek: 1 | 6 | 7  // 1=Mon, 6=Sat, 7=Sun (Intl getWeekInfo values)
}

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

  // ── Locale preferences ───────────────────────────────────────────
  /** Auto-detected from browser locale; overridable by the user. Stored in localStorage (global, not vault-scoped). */
  localePrefs:    LocalePrefs
  setLocalePrefs: (prefs: Partial<LocalePrefs>) => void
}

export const useStore = create<MeridianStore>((set, get) => ({
  items: [],
  roots: new Map(),
  fom: new Map(),
  setData: ({ items, roots }) => {
    const t0 = performance.now()
    clearOccIdCache()
    const { items: prevItems, roots: prevRoots, fom: prevFom } = get()
    set({ items, roots, fom: updateFileOccurrenceMap(prevFom, prevItems, prevRoots, items, roots) })
    console.debug(`[perf:store] setData total (sync): ${(performance.now() - t0).toFixed(2)}ms`)
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
  loadFavorites: (vaultId: string) => {
    try {
      const raw = localStorage.getItem(`meridian_favorites_${vaultId}`)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      set({ favorites: Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [] })
    } catch {
      set({ favorites: [] })
    }
  },
  toggleFavorite: (fileSlug: string) => {
    const { favorites, activeVaultId } = get()
    const next = favorites.includes(fileSlug)
      ? favorites.filter(s => s !== fileSlug)
      : [...favorites, fileSlug]
    if (activeVaultId) localStorage.setItem(`meridian_favorites_${activeVaultId}`, JSON.stringify(next))
    set({ favorites: next })
  },
  reorderFavorites: (fromIdx: number, toIdx: number) => {
    const { favorites, activeVaultId } = get()
    if (toIdx < 0 || toIdx >= favorites.length) return
    const next = [...favorites]
    const [item] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, item)
    if (activeVaultId) localStorage.setItem(`meridian_favorites_${activeVaultId}`, JSON.stringify(next))
    set({ favorites: next })
  },

  defaultParticipants: [],
  loadDefaultParticipants: (vaultId: string) => {
    try {
      const raw = localStorage.getItem(`meridian_default_participants_${vaultId}`)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      set({ defaultParticipants: Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [] })
    } catch {
      set({ defaultParticipants: [] })
    }
  },
  setDefaultParticipants: (participants: string[]) => {
    const { activeVaultId } = get()
    if (activeVaultId)
      localStorage.setItem(`meridian_default_participants_${activeVaultId}`, JSON.stringify(participants))
    set({ defaultParticipants: participants })
  },

  participantFilter: [],
  loadParticipantFilter: (vaultId: string) => {
    try {
      const raw = localStorage.getItem(`meridian_participant_filter_${vaultId}`)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      set({ participantFilter: Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [] })
    } catch {
      set({ participantFilter: [] })
    }
  },
  toggleParticipantFilter: (name: string) => {
    const { participantFilter, activeVaultId } = get()
    const next = participantFilter.includes(name)
      ? participantFilter.filter(s => s !== name)
      : [...participantFilter, name]
    if (activeVaultId) localStorage.setItem(`meridian_participant_filter_${activeVaultId}`, JSON.stringify(next))
    set({ participantFilter: next })
  },
  clearParticipantFilter: () => {
    const { activeVaultId } = get()
    if (activeVaultId) localStorage.setItem(`meridian_participant_filter_${activeVaultId}`, JSON.stringify([]))
    set({ participantFilter: [] })
  },

  localePrefs: loadLocalePrefs(),
  setLocalePrefs: (prefs: Partial<LocalePrefs>) => {
    const next = { ...get().localePrefs, ...prefs }
    localStorage.setItem('meridian_locale_prefs', JSON.stringify(next))
    set({ localePrefs: next })
  },
}))
