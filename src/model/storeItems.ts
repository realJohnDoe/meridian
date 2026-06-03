/**
 * Parse a file (path + raw content) into a flat StoreItem[].
 *
 * This is the single load path for both disk files and seed YAML strings.
 * RawNode / EffectiveNode never leave this module — callers receive StoreItem[]
 * and never need to know the YAML shape.
 */

import { loadFile } from '../fileIO'
import { buildEffectiveTree } from './inheritance'
import type { EffectiveNode } from './inheritance'
import { hasRepeat } from './expansion'
import type { Repeat } from '../types'
import { extractAppMetadata, isSeries } from '../types'
import type { StoreItem } from '../types'

// ── Walker ────────────────────────────────────────────────────────────────────

/**
 * Walk an inheritance-resolved EffectiveNode tree and emit StoreItems.
 *
 *  - Series node (has `repeat`) → RepeatPattern. Its metadata merges the node's
 *    accumulated `childDefaults` (where task fields like `done`/`priority` live
 *    when written in a `defaults:` block) under its own `fields`.
 *  - Explicit instance children of a series → OccurrenceEntry overrides (with
 *    `ownerId`); exclusion markers kept as `excluded: true`.
 *  - Nested series child → walked as its own flat sibling series.
 *  - Node with a `date` but no `repeat` → standalone OccurrenceEntry; its
 *    explicit instances become additional standalones.
 *  - Container node (no repeat, no date) → recurse into instances.
 */
export function effectiveNodeToStoreItems(
  tree: EffectiveNode,
  fileSlug: string,
  rootBody?: string,
): StoreItem[] {
  const result: StoreItem[] = []
  let isFirst = true

  function walk(n: EffectiveNode) {
    // Merge childDefaults under fields so task defaults (done/priority) that live
    // in a `defaults:` block survive — mirrors `toExpandable` in expansion.ts.
    const base = { ...n.childDefaults, ...n.fields }

    if (hasRepeat(n)) {
      const seriesId = crypto.randomUUID()
      const meta = extractAppMetadata(base)
      // Root body (markdown after frontmatter) belongs to the first series/standalone.
      if (isFirst && rootBody) { meta.body = rootBody; isFirst = false }
      result.push({
        date:   n.fields.date ? String(n.fields.date) : '',
        time:   n.fields.time ? String(n.fields.time) : null,
        repeat: n.fields.repeat as Repeat,
        fileSlug,
        id:     seriesId,
        metadata: meta,
      })
      for (const child of n.instances) {
        if (hasRepeat(child)) { walk(child); continue }  // nested series → flat sibling
        result.push({
          date:    child.fields.date ? String(child.fields.date) : '',
          time:    child.fields.time ? String(child.fields.time) : null,
          source:  'explicit',
          fileSlug,
          id:      crypto.randomUUID(),
          ownerId: seriesId,
          ...(child.fields.excluded === true ? { excluded: true as const } : {}),
          metadata: extractAppMetadata({ ...base, ...child.fields }),
        })
      }
    } else if (n.fields.date !== undefined) {
      const meta = extractAppMetadata(base)
      if (isFirst && rootBody) { meta.body = rootBody; isFirst = false }
      result.push({
        date:   String(n.fields.date),
        time:   n.fields.time ? String(n.fields.time) : null,
        source: 'explicit',
        fileSlug,
        id:     crypto.randomUUID(),
        metadata: meta,
      })
      for (const child of n.instances) {
        if (child.fields.excluded === true) continue
        result.push({
          date:   child.fields.date ? String(child.fields.date) : '',
          time:   child.fields.time ? String(child.fields.time) : null,
          source: 'explicit',
          fileSlug,
          id:     crypto.randomUUID(),
          metadata: extractAppMetadata({ ...base, ...child.fields }),
        })
      }
    } else {
      n.instances.forEach(walk)  // container node
    }
  }

  walk(tree)
  return result
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a markdown/YAML file into a flat StoreItem[].
 * Replaces `rawToNode` + `nodesToStoreItems`.
 */
export function parseToStoreItems(path: string, content: string): StoreItem[] {
  const { rawNode, body } = loadFile(path, content)
  const fileSlug = path.replace(/\.(md|yaml|yml)$/, '')
  const tree = buildEffectiveTree(rawNode as Parameters<typeof buildEffectiveTree>[0])
  return effectiveNodeToStoreItems(tree, fileSlug, body)
}

/**
 * Convert a YAML string (not a file path) — used for seed data.
 * `id` becomes the fileSlug.
 */
export function parseYamlToStoreItems(yamlWithFrontmatter: string, fileSlug: string): StoreItem[] {
  const { rawNode, body } = loadFile(fileSlug + '.md', yamlWithFrontmatter)
  const tree = buildEffectiveTree(rawNode as Parameters<typeof buildEffectiveTree>[0])
  return effectiveNodeToStoreItems(tree, fileSlug, body)
}

// Re-export isSeries so storeOps can import it from here alongside item types.
export { isSeries }
