import { create } from 'zustand'
import type { StoreItem, Roots } from './types'
import type { VaultRef } from './storage/backend'
import { clearOccIdCache } from './model/expansion'
import { resetFOMCache } from './presentation'

interface MeridianStore {
  // ── Data ────────────────────────────────────────────────────────
  items: StoreItem[]
  roots: Roots
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
  /** Briefly true after a successful sync (drives the green flash). */
  syncFlash: boolean
  /** True when the most recent sync attempt failed (drives the red icon). */
  syncError: boolean

  // ── Agenda scroll ────────────────────────────────────────────────
  /** When true, AgendaPage will scroll to today once then clear this flag. */
  scrollToTodayOnce: boolean
  /** ISO date string of the topmost visible day in the agenda view. */
  agendaTopDate: string | null
}

export const useStore = create<MeridianStore>((set) => ({
  items: [],
  roots: new Map(),
  setData: ({ items, roots }) => { clearOccIdCache(); resetFOMCache(); set({ items, roots }) },

  vaults:              [],
  activeVaultId:       null,
  pendingDirReconnect: null,

  syncDirtyCount: 0,
  syncFlash:      false,
  syncError:      false,

  scrollToTodayOnce: false,
  agendaTopDate:     null,
}))
