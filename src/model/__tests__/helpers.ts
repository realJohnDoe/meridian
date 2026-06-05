import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { parseToStoreItems } from '../storeItems'
import { collapseToYaml } from '../collapse'
import { saveFile } from '../../fileIO'
import { isSeries, isRootNode } from '../../types'
import type { StoreItem, FileMetadata } from '../../types'

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

/** Parse a fixture into StoreItem[] using the real app load path. */
export function parseFixture(name: string): StoreItem[] {
  return parseToStoreItems(`${name}.md`, loadFixture(name))
}

/**
 * Serialize StoreItem[] back to file content — mirrors writeEntityToCache():
 * collapse to canonical YAML, then attach the body of the first series/standalone.
 * This is the exact path the app uses when persisting, so tests exercise it.
 */
export function serialize(items: StoreItem[]): string {
  const frontmatter = collapseToYaml(items)
  const body = items.find(isRootNode)?.metadata.body ?? ''
  return saveFile(frontmatter, body)
}

/** The per-file root node's file-level metadata (title/tags/topics/body). */
export function rootMeta(items: StoreItem[]): FileMetadata | undefined {
  const root = items.find(isRootNode)
  return root?.metadata as FileMetadata | undefined
}

/** Items excluding the per-file root node (i.e. series + occurrences). */
export function occItems(items: StoreItem[]): StoreItem[] {
  return items.filter(i => !isRootNode(i))
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
