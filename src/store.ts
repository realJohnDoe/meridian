import { create } from 'zustand'
import type { Node } from './types'

// Stable today reference (matches the one in meridian.ts)
const _today = new Date(); _today.setHours(0, 0, 0, 0)

interface MeridianStore {
  // ── Data ────────────────────────────────────────────────────────
  nodes: Node[]
  setNodes: (nodes: Node[]) => void

  nextId: number
  /** Consume the next available id and increment the counter. */
  bumpId: () => number

  // ── Navigation ──────────────────────────────────────────────────
  curView: string
  prevView: string
  setCurView: (view: string) => void
  setPrevView: (view: string) => void

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

  curView: 'agenda',
  prevView: 'agenda',
  setCurView: (curView) => set({ curView }),
  setPrevView: (prevView) => set({ prevView }),

  calMonth: new Date(_today.getFullYear(), _today.getMonth(), 1),
  setCalMonth: (calMonth) => set({ calMonth }),

  dvDate: new Date(_today),
  setDvDate: (dvDate) => set({ dvDate }),

  nsFilterVal: 'all',
  setNsFilterVal: (nsFilterVal) => set({ nsFilterVal }),

  dirHandle: null,
  setDirHandle: (dirHandle) => set({ dirHandle }),
}))
