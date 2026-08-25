import { afterEach, beforeEach } from 'vitest'
import { useStore } from '@/store'
import { setEntityPersistence } from '@/persistencePort'
import { resetCalendarOnVaultChange } from '@/calendar'
import { entryKey as makeEntryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { Occurrence, StoreSeries, StoreItem, Roots, FileMetadata, Entries } from '@/types'

const initialStoreState = useStore.getInitialState()

/**
 * The vault every test fixture belongs to. Entry identity is vault-qualified,
 * so a fixture needs *a* vault — one shared constant keeps every helper's keys
 * comparable without each test inventing its own id.
 */
export const TEST_VAULT = 'test-vault'

/** `entryKey(TEST_VAULT, slug)` — the fixture form of an entry identity. */
export function testKey(slug: string): EntryKey {
  return makeEntryKey(TEST_VAULT, slug)
}

/** Resets the store (a module singleton) to a clean, deterministic state around each test. */
export function setupStore(): void {
  beforeEach(() => {
    // defaultVaultId is where a brand-new entry goes (see saveNode); without it
    // creating an entry in a test would have no target vault at all.
    useStore.setState({ localePrefs: { hour12: false, firstDayOfWeek: 1 }, defaultVaultId: TEST_VAULT })
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

/**
 * Group a flat `items`/`roots` pair into `Entries`.
 *
 * Tests describe a store the flat way — it reads better at the call site, and
 * most of them predate the aggregate — so the grouping happens here, once,
 * rather than in every test that seeds a store.
 */
export function entriesOf(items: StoreItem[], roots: Roots): Entries {
  const entries: Entries = new Map()
  for (const item of items) {
    const entry = entries.get(item.entryKey)
    if (entry) entry.items.push(item)
    else entries.set(item.entryKey, { key: item.entryKey, root: rootFor(item.entryKey), items: [item] })
  }
  // Roots second, so a key with items keeps them and only gains its real root.
  // A root with no items is silently dropped: `Entry['items']` is non-empty, so
  // there is no entry for it to become — which is the invariant, not a gap.
  for (const [key, root] of roots) {
    const entry = entries.get(key)
    if (entry) entries.set(key, { ...entry, root })
  }
  return entries
}

/** A minimal root for an item whose key the caller gave no root for. */
function rootFor(key: EntryKey): FileMetadata {
  const [vaultId = '', fileSlug = ''] = key.split('::')
  return { title: '', tags: [], items: [], vaultId, fileSlug }
}

export function seedStore(items: StoreItem[], roots: Roots): void {
  useStore.setState({ defaultVaultId: TEST_VAULT })
  useStore.getState().setData(entriesOf(items, roots))
}

export interface FakePersistence {
  /** Keys written, in order — for tests that only care that a save was made. */
  writes: string[]
  /**
   * What each write actually carried, keyed by entry. This is the half that
   * used to be missing: the fake recorded only keys, so `writes` asserted that
   * a save was *requested* for K and nothing anywhere asserted that K's file
   * got the right bytes — or any bytes at all. A write path that silently did
   * nothing passed every editor test in the suite.
   */
  contentByKey: Map<string, string>
  deletes: string[]
  /** `[fromKey, toKey, content]` per cross-vault move. */
  moves: Array<[string, string, string]>
}

/** Registers a fake EntityPersistence so tests never touch IndexedDB/GitHub. */
export function installFakePersistence(): FakePersistence {
  const calls: FakePersistence = { writes: [], contentByKey: new Map(), deletes: [], moves: [] }
  beforeEach(() => {
    calls.writes = []
    calls.contentByKey = new Map()
    calls.deletes = []
    calls.moves = []
    setEntityPersistence({
      writeEntity: (key, content) => { calls.writes.push(key); calls.contentByKey.set(key, content) },
      deleteEntity: (key) => { calls.deletes.push(key) },
      moveEntity: (fromKey, toKey, content) => { calls.moves.push([fromKey, toKey, content]) },
    })
  })
  return calls
}

export function makeOcc(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    date: '2026-06-15',
    time: '09:00',
    source: 'explicit',
    entryKey: testKey('note.md'),
    id: 'occ-1',
    metadata: { participants: [], title: 'Standup', tags: [], items: [], vaultId: TEST_VAULT, fileSlug: 'note.md' },
    ...overrides,
  }
}

export function makeSeries(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-06-01',
    time: '09:00',
    entryKey: testKey('note.md'),
    id: 'series-1',
    repeat: { type: 'schedule', freq: 'daily' },
    metadata: { participants: [] },
    ...overrides,
  }
}

/**
 * A complete `FileMetadata` for `slug` in the test vault. `vaultId`/`fileSlug`
 * are runtime provenance a parse always supplies, so a fixture has to as well —
 * wikilink resolution and backlinks read them off the root, not off the key.
 */
export function makeRootMeta(fileSlug: string, meta: Partial<FileMetadata> = {}): FileMetadata {
  return { title: 'Note', tags: [], items: [], vaultId: TEST_VAULT, fileSlug, ...meta }
}

export function makeRoots(slug: string, meta: Partial<FileMetadata> = {}): Roots {
  return new Map([[testKey(slug), makeRootMeta(slug, meta)]])
}
