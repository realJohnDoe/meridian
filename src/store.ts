import { create } from 'zustand'
import type { StoreItem, Roots } from './types'
import type { VaultRef } from './storage/backend'

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

  // ── Agenda scroll ────────────────────────────────────────────────
  /** When true, AgendaPage will scroll to today once then clear this flag. */
  scrollToTodayOnce: boolean
}

export const useStore = create<MeridianStore>((set) => ({
  items: [],
  roots: new Map(),
  setData: ({ items, roots }) => set({ items, roots }),

  vaults:              [],
  activeVaultId:       null,
  pendingDirReconnect: null,

  syncDirtyCount: 0,
  syncFlash:      false,

  scrollToTodayOnce: false,
}))
