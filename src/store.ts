import { create } from 'zustand'
import type { StoreItem } from './types'
import { TODAY as _today } from './constants'

export type PrimaryView = 'agenda' | 'calendar' | 'day'
export type OverlayView = 'entry'

interface MeridianStore {
  // ── Data ────────────────────────────────────────────────────────
  items: StoreItem[]
  setItems: (items: StoreItem[]) => void

  // ── Navigation ──────────────────────────────────────────────────
  /** The active primary tab — always visible behind any overlay. */
  primaryView: PrimaryView
  setPrimaryView: (v: PrimaryView) => void

  /**
   * Overlay stack — last entry is the topmost visible view.
   * Only 'entry' is an overlay view; it slides over primary views.
   */
  overlayStack: OverlayView[]
  pushOverlay: (v: OverlayView) => void
  /** Pop the top overlay. No-op if the stack is empty. */
  popOverlay: () => void

  // ── Calendar cursor ─────────────────────────────────────────────
  calMonth: Date
  setCalMonth: (d: Date) => void

  // ── Day-view cursor ─────────────────────────────────────────────
  dvDate: Date
  setDvDate: (d: Date) => void

  // ── Search ──────────────────────────────────────────────────────
  nsFilterVal: string
  setNsFilterVal: (f: string) => void

  // ── File system ─────────────────────────────────────────────────
  dirHandle: FileSystemDirectoryHandle | null
  setDirHandle: (h: FileSystemDirectoryHandle | null) => void
  /** Non-null when a persisted handle exists but needs a user gesture to re-grant permission. */
  pendingDirReconnect: string | null
  setPendingDirReconnect: (name: string | null) => void

  // ── Undo toast ──────────────────────────────────────────────────
  toast: { title: string; onUndo: () => void } | null
  setToast: (t: { title: string; onUndo: () => void } | null) => void

  // ── Sync status ─────────────────────────────────────────────────
  /** Number of dirty (unsynced) files in the IndexedDB cache. */
  syncDirtyCount: number
  setSyncDirtyCount: (n: number) => void
  /** Briefly true after a successful sync (drives the green flash). */
  syncFlash: boolean
  setSyncFlash: (v: boolean) => void

  // ── Error notification ──────────────────────────────────────────
  /** Non-null while an error banner is visible. */
  errorNotification: string | null
  setErrorNotification: (msg: string | null) => void
}

export const useStore = create<MeridianStore>((set) => ({
  // items starts empty; tryRestoreDirectory() seeds it (or disk data replaces
  // it when the user opens a vault folder).
  items: [],
  setItems: (items) => set({ items }),

  primaryView: 'agenda',
  setPrimaryView: (primaryView) => set({ primaryView }),

  overlayStack: [],
  pushOverlay: (v) => set(s => ({ overlayStack: [...s.overlayStack, v] })),
  popOverlay:  ()  => set(s => ({ overlayStack: s.overlayStack.slice(0, -1) })),

  calMonth: new Date(_today.getFullYear(), _today.getMonth(), 1),
  setCalMonth: (calMonth) => set({ calMonth }),

  dvDate: new Date(_today),
  setDvDate: (dvDate) => set({ dvDate }),

  nsFilterVal: 'all',
  setNsFilterVal: (nsFilterVal) => set({ nsFilterVal }),

  dirHandle: null,
  setDirHandle: (dirHandle) => set({ dirHandle }),
  pendingDirReconnect: null,
  setPendingDirReconnect: (pendingDirReconnect) => set({ pendingDirReconnect }),

  toast: null,
  setToast: (toast) => set({ toast }),

  syncDirtyCount: 0,
  setSyncDirtyCount: (syncDirtyCount) => set({ syncDirtyCount }),
  syncFlash: false,
  setSyncFlash: (syncFlash) => set({ syncFlash }),

  errorNotification: null,
  setErrorNotification: (errorNotification) => set({ errorNotification }),
}))
