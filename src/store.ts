import { create } from 'zustand'
import type { StoreItem, Roots, Occurrence } from './types'
import type { VaultRef } from './storage/backend'
import { clearOccIdCache } from './model/expansion'
import { fileOccurrenceMap } from './fileOccurrence'

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
}

export const useStore = create<MeridianStore>((set, get) => ({
  items: [],
  roots: new Map(),
  fom: new Map(),
  setData: ({ items, roots }) => { clearOccIdCache(); set({ items, roots, fom: fileOccurrenceMap(items, roots) }) },

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
}))
