import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseToStoreItems } from '@/model/storeItems'
import type { ParseResult } from '@/model/storeItems'
import { collapseToYaml } from '@/model/collapse'
import { saveFile } from '@/model/inheritance'
import { joinFileMeta } from '@/model/expansion'
import { loadFile } from '@/fileIO'
// Re-exported from production rather than duplicated: this is the exact
// comparison the runtime round-trip guard uses, and two hand-synced copies of
// it would be the same 'mock agrees with real code by convention' problem the
// survey flagged in the storage cache's mocks.
export { collectKeyValues } from '@/model/roundTripCheck'
import { isSeries } from '@/types'
import { entryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import type { StoreItem, FileMetadata, AppMetadata, Roots, OccurrenceEntry } from '@/types'

/**
 * The vault every model fixture is parsed into. Entry identity is
 * vault-qualified, so a parse needs a vault; one shared constant keeps every
 * fixture's keys comparable. Deliberately duplicated from `@/test-utils`'
 * value rather than imported: that module pulls in the Zustand store and the
 * calendar barrel, and the model suite is pure and node-only by design.
 */
export const TEST_VAULT = 'test-vault'

/** Where `applyEdit`'s create leg puts a brand-new entry in these fixtures. */
export const NEW_TARGET = { vaultId: TEST_VAULT }

/** `entryKey(TEST_VAULT, slug)` — the fixture form of an entry identity. */
export function keyOf(slug: string): EntryKey {
  return entryKey(TEST_VAULT, slug)
}

/**
 * A `Roots` map from parsed roots, keyed the way the app keys it. Each root
 * already carries its own `vaultId`/`fileSlug`, so this can't disagree with
 * the items' `entryKey` the way a hand-built `new Map([[slug, root]])` could.
 */
export function rootsOf(...roots: FileMetadata[]): Roots {
  return new Map(roots.map(r => [entryKey(r.vaultId, r.fileSlug), r]))
}

const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE_DIR = resolve(HERE, 'fixtures')

/** Raw file content of a fixture, e.g. loadFixture('weekly-series'). */
export function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, `${name}.md`), 'utf-8')
}

/** Every fixture base-name (no extension), for table-driven tests. */
export function fixtureNames(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''))
    .sort()
}

/** Parse a fixture into {items, root} using the real app load path. */
export function parseFixture(name: string): ParseResult {
  return parseToStoreItems(`${name}.md`, loadFixture(name), TEST_VAULT)
}

/**
 * Serialize StoreItem[] + FileMetadata back to file content — mirrors writeEntityToCache():
 * collapse to canonical YAML, then attach the body.
 * This is the exact path the app uses when persisting, so tests exercise it.
 */
export function serialize(items: StoreItem[], root?: FileMetadata): string {
  const frontmatter = collapseToYaml(items, root)
  const body = root?.body ?? ''
  return saveFile(frontmatter, body, root?.fileConvention)
}


/** Parsed frontmatter of a file's raw content. */
export function frontmatterOf(content: string): Record<string, unknown> {
  return loadFile('x.md', content).rawNode
}

/** The per-file root metadata (title/tags/items/body). */
export function rootMeta(result: ParseResult): FileMetadata {
  return result.root
}

/** The occurrence items from a ParseResult (series + standalone occurrences). */
export function occItems(result: ParseResult): StoreItem[] {
  return result.items
}

/** Collect standalone occurrences with no date — test helper for verifying undated items. */
export function collectUndated(items: StoreItem[], roots: Roots): OccurrenceEntry<AppMetadata>[] {
  const undated = items.filter(
    i => !isSeries(i)
      && !(i as OccurrenceEntry<AppMetadata>).ownerId
      && !i.date,
  ) as OccurrenceEntry<AppMetadata>[]
  return undated.map(occ => ({
    ...occ,
    metadata: joinFileMeta(occ.entryKey, occ.metadata, roots),
  }))
}

/**
 * Strip volatile fields (random UUIDs) so two parses of equivalent content
 * compare equal. ownerId is rewritten to the index of its series so the
 * series↔override linkage is still asserted structurally.
 */
export function normalizeIds(items: StoreItem[]): unknown[] {
  const seriesIndex = new Map<string, number>()
  items.forEach((i, idx) => { if (isSeries(i)) seriesIndex.set(i.id, idx) })
  return items.map(i => {
    const { id: _id, ownerId, ...rest } = i as StoreItem & { ownerId?: string }
    return {
      ...rest,
      ...(ownerId !== undefined ? { ownerSeries: seriesIndex.get(ownerId) ?? 'unknown' } : {}),
    }
  })
}
