import { afterEach, beforeEach } from 'vitest'
import { useStore } from '@/store'
import { setEntityPersistence } from '@/persistencePort'
import { resetCalendarOnVaultChange } from '@/calendar'
import type { Occurrence, StoreSeries, StoreItem, Roots, FileMetadata } from '@/types'

const initialStoreState = useStore.getInitialState()

/** Resets the store (a module singleton) to a clean, deterministic state around each test. */
export function setupStore(): void {
  beforeEach(() => {
    useStore.setState({ localePrefs: { hour12: false, firstDayOfWeek: 1 } })
  })
  afterEach(() => {
    useStore.setState(initialStoreState, true)
    // The expansion and agenda-sections caches (src/calendar/useExpandWithMultiday.ts,
    // src/calendar/useAgendaSections.ts) and the calendar view-state store
    // (src/calendar/viewState.ts) are module-level singletons shared across
    // renders, so they survive past a single test unless cleared — without
    // this, one test's cached window/sections/scroll snapshot could leak into
    // the next when both use structurally-identical items.
    resetCalendarOnVaultChange()
  })
}

/**
 * Installs a controllable `window.matchMedia` around each test in the calling
 * describe block, and returns a setter that flips the answer and notifies
 * subscribers.
 *
 * The global stub in `setup.ts` answers every `min-width` query with
 * `matches: true` and registers no listeners. That leaves two things
 * untestable: the mobile branch of anything built on `useMediaQuery` (e.g.
 * ResponsiveModal's Drawer, which no existing test has ever rendered), and
 * breakpoint *changes* — `useMediaQuery` subscribes via `useSyncExternalStore`
 * (src/hooks/use-media-query.ts), and a no-op `addEventListener` means that
 * subscription can never fire.
 *
 * Call at describe scope, like {@link setupStore}. Wrap the returned setter in
 * `act()` — it notifies React synchronously.
 */
export function setMediaQuery(initialMatches: boolean): (next: boolean) => void {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  let matches = initialMatches
  // eslint-disable-next-line @typescript-eslint/unbound-method -- stashed for restore, never called unbound
  const original = window.matchMedia

  beforeEach(() => {
    matches = initialMatches
    listeners.clear()
    window.matchMedia = ((query: string) => ({
      // getter, not a snapshot: useSyncExternalStore re-reads this on every
      // notify, so a plain `matches: matches` would freeze at the initial value.
      get matches() { return matches },
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb) },
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb) },
      addListener: (cb: (e: MediaQueryListEvent) => void) => { listeners.add(cb) },
      removeListener: (cb: (e: MediaQueryListEvent) => void) => { listeners.delete(cb) },
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
  })

  afterEach(() => {
    window.matchMedia = original
  })

  return (next: boolean) => {
    matches = next
    for (const cb of listeners) cb({ matches: next } as MediaQueryListEvent)
  }
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
    entryKey: 'note.md',
    id: 'occ-1',
    metadata: { participants: [], title: 'Standup', tags: [], items: [] },
    ...overrides,
  }
}

export function makeSeries(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-06-01',
    time: '09:00',
    entryKey: 'note.md',
    id: 'series-1',
    repeat: { type: 'schedule', freq: 'daily' },
    metadata: { participants: [] },
    ...overrides,
  }
}

export function makeRoots(slug: string, meta: Partial<FileMetadata> = {}): Roots {
  return new Map([[slug, { title: 'Note', tags: [], items: [], ...meta }]])
}
