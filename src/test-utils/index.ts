import { afterEach, beforeEach } from 'vitest'
import { useStore } from '@/store'
import { setEntityPersistence } from '@/persistencePort'
import type { Occurrence, StoreSeries, StoreItem, Roots, FileMetadata } from '@/types'

const initialStoreState = useStore.getInitialState()

/** Resets the store (a module singleton) to a clean, deterministic state around each test. */
export function setupStore(): void {
  beforeEach(() => {
    useStore.setState({ localePrefs: { hour12: false, firstDayOfWeek: 1 } })
  })
  afterEach(() => {
    useStore.setState(initialStoreState, true)
  })
}

export function seedStore(items: StoreItem[], roots: Roots): void {
  useStore.getState().setData({ items, roots })
}

export interface FakePersistence {
  writes: string[]
  deletes: string[]
}

/** Registers a fake EntityPersistence so tests never touch IndexedDB/GitHub. */
export function installFakePersistence(): FakePersistence {
  const calls: FakePersistence = { writes: [], deletes: [] }
  beforeEach(() => {
    calls.writes = []
    calls.deletes = []
    setEntityPersistence({
      writeEntity: (slug) => { calls.writes.push(slug) },
      deleteEntity: (slug) => { calls.deletes.push(slug) },
    })
  })
  return calls
}

export function makeOcc(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    date: '2026-06-15',
    time: '09:00',
    source: 'explicit',
    fileSlug: 'note.md',
    id: 'occ-1',
    metadata: { participants: [], title: 'Standup', tags: [], items: [] },
    ...overrides,
  }
}

export function makeSeries(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-06-01',
    time: '09:00',
    fileSlug: 'note.md',
    id: 'series-1',
    repeat: { type: 'schedule', freq: 'daily' },
    metadata: { participants: [] },
    ...overrides,
  }
}

export function makeRoots(slug: string, meta: Partial<FileMetadata> = {}): Roots {
  return new Map([[slug, { title: 'Note', tags: [], items: [], ...meta }]])
}
