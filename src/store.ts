import { create } from 'zustand'
import type { Node } from './types'
import { TODAY as _today } from './constants'

export type PrimaryView = 'agenda' | 'calendar' | 'day'
export type OverlayView = 'entry' | 'search'

interface MeridianStore {
  // ── Data ────────────────────────────────────────────────────────
  nodes: Node[]
  setNodes: (nodes: Node[]) => void

  nextId: number
  /** Consume the next available id and increment the counter. */
  bumpId: () => number

  // ── Navigation ──────────────────────────────────────────────────
  /** The active primary tab — always visible behind any overlay. */
  primaryView: PrimaryView
  setPrimaryView: (v: PrimaryView) => void

  /**
   * Overlay stack — last entry is the topmost visible view.
   * Only 'entry' and 'search' are overlay views; they slide over primary views.
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

export const useStore = create<MeridianStore>((set, get) => ({
  // nodes starts empty; initApp() seeds it with SEED_NODES (or disk data
  // replaces it when the user opens a vault folder).
  nodes: [],
  setNodes: (nodes) => set({ nodes }),

  nextId: 200,
  bumpId: () => {
    const id = get().nextId
    set({ nextId: id + 1 })
    return id
  },

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

  toast: null,
  setToast: (toast) => set({ toast }),

  syncDirtyCount: 0,
  setSyncDirtyCount: (syncDirtyCount) => set({ syncDirtyCount }),
  syncFlash: false,
  setSyncFlash: (syncFlash) => set({ syncFlash }),

  errorNotification: null,
  setErrorNotification: (errorNotification) => set({ errorNotification }),
}))
