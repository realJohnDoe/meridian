import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseToStoreItems } from '@/model/storeItems'
import type { ParseResult } from '@/model/storeItems'
import { collapseToYaml } from '@/model/collapse'
import { saveFile } from '@/fileIO'
import { joinFileMeta } from '@/model/expansion'
import type { OccurrenceEntry } from '@/model/expansion'
import { isSeries } from '@/types'
import type { StoreItem, FileMetadata, AppMetadata, Roots } from '@/types'

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
  return parseToStoreItems(`${name}.md`, loadFixture(name))
}

/**
 * Serialize StoreItem[] + FileMetadata back to file content — mirrors writeEntityToCache():
 * collapse to canonical YAML, then attach the body.
 * This is the exact path the app uses when persisting, so tests exercise it.
 */
export function serialize(items: StoreItem[], root?: FileMetadata): string {
  const frontmatter = collapseToYaml(items, root)
  const body = root?.body ?? ''
  return saveFile(frontmatter, body)
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
    metadata: joinFileMeta(occ.fileSlug, occ.metadata, roots),
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
