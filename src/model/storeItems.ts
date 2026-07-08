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

import { loadFile } from '@/fileIO'
import { buildEffectiveTree } from './inheritance'
import type { EffectiveNode } from './inheritance'
import { hasRepeat } from './expansion'
import type { Repeat } from '@/types'
import { extractFileMetadata, extractOccurrenceMetadata } from '@/types'
import type { StoreItem, FileMetadata } from '@/types'

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
      const anchorDate = n.fields.date ? String(n.fields.date) : ''
      const anchorTime = n.fields.time ? String(n.fields.time) : ''
      const seriesId = stableId(`${fileSlug}|series|${anchorDate}|${anchorTime}`)
      result.push({
        date:   n.fields.date ? String(n.fields.date) : '',
        time:   n.fields.time ? String(n.fields.time) : null,
        repeat: n.fields.repeat as Repeat,
        fileSlug,
        id:     seriesId,
        metadata: extractOccurrenceMetadata(base),
      })
      for (const child of n.instances) {
        if (hasRepeat(child)) { walk(child); continue }  // nested series → flat sibling
        const childDate = child.fields.date ? String(child.fields.date) : ''
        const childTime = child.fields.time ? String(child.fields.time) : ''
        result.push({
          date:    childDate,
          time:    child.fields.time ? String(child.fields.time) : null,
          source:  'explicit',
          fileSlug,
          id:      stableId(`${seriesId}|inst|${childDate}|${childTime}`),
          ownerId: seriesId,
          ...(child.fields.excluded === true ? { excluded: true as const } : {}),
          metadata: extractOccurrenceMetadata({ ...base, ...child.fields }),
        })
      }
    } else if (n.fields.date !== undefined || n.instances.length === 0) {
      // A node with a date, OR a leaf with none (e.g. an undated task/note),
      // becomes a standalone occurrence. The empty-date case keeps undated items
      // representable so they round-trip and stay searchable.
      const occDate = n.fields.date !== undefined ? String(n.fields.date) : 'undated'
      const occTime = n.fields.time ? String(n.fields.time) : ''
      result.push({
        date:   n.fields.date !== undefined ? String(n.fields.date) : '',
        time:   n.fields.time ? String(n.fields.time) : null,
        source: 'explicit',
        fileSlug,
        id:     stableId(`${fileSlug}|occ|${occDate}|${occTime}`),
        metadata: extractOccurrenceMetadata(base),
      })
      for (const child of n.instances) {
        if (child.fields.excluded === true) continue
        const childDate = child.fields.date ? String(child.fields.date) : 'undated'
        const childTime = child.fields.time ? String(child.fields.time) : ''
        result.push({
          date:   child.fields.date ? String(child.fields.date) : '',
          time:   child.fields.time ? String(child.fields.time) : null,
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
  const fileSlug = path.replace(/\.(md|yaml|yml)$/, '')
  const tree = buildEffectiveTree(rawNode as Parameters<typeof buildEffectiveTree>[0])
  const items = effectiveNodeToStoreItems(tree, fileSlug)
  return { items, root: buildRoot(rawNode, body) }
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
 */
function buildRoot(
  rawNode: Record<string, unknown>,
  body: string,
): FileMetadata {
  const defaults = (rawNode.defaults as Record<string, unknown> | undefined) ?? {}
  return extractFileMetadata({ ...defaults, ...rawNode, body: body || undefined })
}
