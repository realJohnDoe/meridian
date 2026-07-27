/**
 * Parse a file (path + raw content) into StoreItem[] + FileMetadata root.
 *
 * This is the single load path for both disk files and seed YAML strings.
 * RawNode / EffectiveNode are implementation details of this pipeline — callers
 * receive { items: StoreItem[], root: FileMetadata } and never need the YAML
 * shape. The one exception is NodeInheritanceDebugger, which imports
 * EffectiveNode from inheritance.ts directly to visualise the parse tree.
 *
 * StoreItem carries OccurrenceMetadata only (no file-level fields).
 * File-level fields (title/tags/topics/body) live in the returned FileMetadata
 * and belong in the store's roots map keyed by fileSlug.
 */

import { loadFile, pathToSlug } from '@/fileIO'
import { buildEffectiveTree } from './inheritance'
import type { EffectiveNode } from './inheritance'
import { hasRepeat } from './expansion'
import type { Repeat } from '@/types'
import { extractFileMetadata, extractOccurrenceMetadata, scalarToString, unknownKeys } from '@/types'
import type { StoreItem, FileMetadata } from '@/types'

// ── Walker ────────────────────────────────────────────────────────────────────

/**
 * True when this node materialises as a StoreItem of its own (series or
 * standalone occurrence) rather than acting as a pure container for `instances`.
 *
 * Also decides who owns the file root's unknown frontmatter keys: when the root
 * IS an item, its keys ride on that item's metadata; only a container root hands
 * them to FileMetadata. Either way exactly one of the two emits them — see
 * `buildRoot` and src/model/AGENTS.md.
 */
function nodeIsItem(n: EffectiveNode): boolean {
  return hasRepeat(n) || n.fields.date !== undefined || n.instances.length === 0
}

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
function effectiveNodeToStoreItems(
  tree: EffectiveNode,
  fileSlug: string,
): StoreItem[] {
  const result: StoreItem[] = []

  // Collision guard: tracks how many times each derived key has been emitted
  // within this file so duplicate-date items get unique #2/#3 suffixes.
  const usedKeys = new Map<string, number>()
  function stableId(key: string): string {
    const n = (usedKeys.get(key) ?? 0) + 1
    usedKeys.set(key, n)
    return n === 1 ? key : `${key}#${n}`
  }

  function walk(n: EffectiveNode) {
    // Merge childDefaults under fields so task defaults (done/priority) that live
    // in a `defaults:` block survive — mirrors `toExpandable` in expansion.ts.
    const base = { ...n.childDefaults, ...n.fields }

    if (hasRepeat(n)) {
      const anchorDate = scalarToString(n.fields.date) ?? ''
      const anchorTime = scalarToString(n.fields.time) ?? ''
      const seriesId = stableId(`${fileSlug}|series|${anchorDate}|${anchorTime}`)
      result.push({
        date:   anchorDate,
        time:   scalarToString(n.fields.time) ?? null,
        repeat: n.fields.repeat as Repeat,
        fileSlug,
        id:     seriesId,
        metadata: extractOccurrenceMetadata(base),
      })
      for (const child of n.instances) {
        if (hasRepeat(child)) { walk(child); continue }  // nested series → flat sibling
        const childDate = scalarToString(child.fields.date) ?? ''
        const childTime = scalarToString(child.fields.time) ?? ''
        result.push({
          date:    childDate,
          time:    scalarToString(child.fields.time) ?? null,
          source:  'explicit',
          fileSlug,
          id:      stableId(`${seriesId}|inst|${childDate}|${childTime}`),
          ownerId: seriesId,
          ...(child.fields.excluded === true ? { excluded: true as const } : {}),
          metadata: extractOccurrenceMetadata({ ...base, ...child.fields }),
        })
      }
    } else if (nodeIsItem(n)) {
      // A node with a date, OR a leaf with none (e.g. an undated task/note),
      // becomes a standalone occurrence. The empty-date case keeps undated items
      // representable so they round-trip and stay searchable.
      const occDate = scalarToString(n.fields.date) ?? 'undated'
      const occTime = scalarToString(n.fields.time) ?? ''
      result.push({
        date:   scalarToString(n.fields.date) ?? '',
        time:   scalarToString(n.fields.time) ?? null,
        source: 'explicit',
        fileSlug,
        id:     stableId(`${fileSlug}|occ|${occDate}|${occTime}`),
        metadata: extractOccurrenceMetadata(base),
      })
      for (const child of n.instances) {
        if (child.fields.excluded === true) continue
        const childDate = scalarToString(child.fields.date) ?? 'undated'
        const childTime = scalarToString(child.fields.time) ?? ''
        result.push({
          date:   scalarToString(child.fields.date) ?? '',
          time:   scalarToString(child.fields.time) ?? null,
          source: 'explicit',
          fileSlug,
          id:     stableId(`${fileSlug}|occ|${childDate}|${childTime}`),
          metadata: extractOccurrenceMetadata({ ...base, ...child.fields }),
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

export interface ParseResult {
  items: StoreItem[]
  root:  FileMetadata
}

/**
 * Parse a markdown/YAML file into StoreItem[] + FileMetadata.
 * Replaces `rawToNode` + `nodesToStoreItems`.
 */
export function parseToStoreItems(path: string, content: string): ParseResult {
  const { rawNode, body } = loadFile(path, content)
  const fileSlug = pathToSlug(path)
  const tree = buildEffectiveTree(rawNode)
  const items = effectiveNodeToStoreItems(tree, fileSlug)
  return { items, root: buildRoot(rawNode, body, nodeIsItem(tree)) }
}

/**
 * Build the FileMetadata for a file from its raw frontmatter + body.
 *
 * File-level fields (title/tags/items) belong to the whole file. They are
 * written at the top-level frontmatter root and are NOT propagated to child
 * series by the defaults-only inheritance engine — so instead of copying them
 * onto every item, we model them explicitly as a FileMetadata entry in the
 * roots map. The markdown body (also file-level) lives there too.
 *
 * File-level values are read from the root frontmatter, falling back to a
 * top-level `defaults:` block for legacy files where they were nested.
 *
 * The unknown-key remainder does NOT use that fallback: it is read from the
 * root's own keys only, and only when the root is a container. Keys inside the
 * root `defaults:` block are inherited by the items, which carry them and hoist
 * them back into `defaults:` on collapse — reading them here too would emit them
 * a second time at the root.
 */
function buildRoot(
  rawNode: Record<string, unknown>,
  body: string,
  rootIsItem: boolean,
): FileMetadata {
  const defaults = (rawNode.defaults as Record<string, unknown> | undefined) ?? {}
  return extractFileMetadata(
    { ...defaults, ...rawNode, body: body || undefined },
    rootIsItem ? undefined : unknownKeys(rawNode),
  )
}
