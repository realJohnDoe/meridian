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
import { extractFileMetadata, extractOccurrenceMetadata, scalarToString, unknownKeys, FILE_LEVEL_SPECS, STRUCTURAL_KEYS } from '@/types'
import type { StoreItem, FileMetadata, OccurrenceMetadata } from '@/types'

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
 * Occurrence metadata for a node that is not the file root.
 *
 * `mergedFields` (parent-inherited + this node's own, typically `base` or
 * `{...base, ...child.fields}`) drives the normal typed-field extraction, same
 * as always. `ownFields` — this node's own explicit properties only, *not*
 * merged with anything inherited — drives a second, narrower check: does this
 * node itself explicitly write a file-level key (title/tags/items)?
 *
 * That second check has to read `ownFields`, not `mergedFields`. A node whose
 * `title` came from an inherited `defaults:` block (`mergedFields.title` set,
 * `ownFields.title` absent) is not this bug — the file root's own `defaults:`
 * block is already read directly by `buildRoot`'s legacy-nesting fallback, so
 * rescuing that same inherited value here a second time, onto every override
 * that merely inherited it, would emit `title:` on each one for no reason.
 * Only a node's own DIVERGENT title — one it wrote itself, not one it
 * inherited — has nowhere else to go and needs rescuing (data-integrity
 * survey, finding #5a).
 */
function extractItemMetadata(
  mergedFields: Record<string, unknown>,
  ownFields: Record<string, unknown>,
  isRoot: boolean,
): OccurrenceMetadata {
  const meta = extractOccurrenceMetadata(mergedFields)
  if (isRoot) return meta
  const fileLevelRemainder: Record<string, unknown> = {}
  for (const spec of FILE_LEVEL_SPECS) {
    if (spec.key in ownFields) fileLevelRemainder[spec.key as string] = ownFields[spec.key as string]
  }
  if (Object.keys(fileLevelRemainder).length === 0) return meta
  // fileLevelRemainder keys are, by construction, never already in meta.extra
  // (RESERVED_KEYS filtered them out of it) — spread order only matters for
  // documenting the same "more specific wins" convention `withAncestorRemainder`
  // relies on below.
  return { ...meta, extra: { ...fileLevelRemainder, ...meta.extra } }
}

/**
 * A container node's own remainder — everything on it besides structural keys.
 *
 * A container (no `date`, no `repeat`) never becomes a `StoreItem` of its own,
 * so unlike a series or standalone it has no `extra` bag to carry its own keys
 * in. Without this, any key written directly on a container — `project: apollo`
 * on a nested grouping entry, say — is silently deleted on the first save (data-
 * integrity survey, finding #5b), same failure as #5a but for a node that can
 * never be rescued by `extractItemMetadata` because it never reaches it.
 *
 * Deliberately untyped: unlike `extractItemMetadata`, this never routes a key
 * through `parseInlineField`/`OCCURRENCE_FIELDS` even if it happens to share a
 * name with a registry field (e.g. a bare `done: false` written directly on a
 * container). Only `defaults:` is specified to propagate as a typed value
 * (spec §2); a container's own bare fields are outside that spec entirely, so
 * treating one as a typed default would invent behaviour nothing asked for.
 * This carries the bytes, nothing more — same restraint as the excluded-child
 * fix (`serializeChildren`) and the malformed-known-field fallback.
 */
function containerOwnRemainder(ownFields: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ownFields)) {
    if (!STRUCTURAL_KEYS.has(k)) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Merge remainder carried down from an enclosing container (see
 * `containerOwnRemainder`) onto an item's own metadata. `meta.extra` spread
 * last so the item's own value for a key always wins over an ancestor's —
 * same child-overrides-parent precedence `defaults:` inheritance already uses
 * everywhere else.
 */
function withAncestorRemainder(meta: OccurrenceMetadata, ancestorRemainder: Record<string, unknown>): OccurrenceMetadata {
  if (Object.keys(ancestorRemainder).length === 0) return meta
  return { ...meta, extra: { ...ancestorRemainder, ...meta.extra } }
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
 *  - Container node (no repeat, no date) → recurse into instances, carrying its
 *    own remainder down (`containerOwnRemainder`) — except at the root, whose
 *    own remainder is already `FileMetadata.extra`'s job (`buildRoot`); carrying
 *    it here too would emit it twice.
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

  function walk(n: EffectiveNode, isRoot: boolean, ancestorRemainder: Record<string, unknown>) {
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
        metadata: withAncestorRemainder(extractItemMetadata(base, n.ownFields, isRoot), ancestorRemainder),
      })
      for (const child of n.instances) {
        if (hasRepeat(child)) { walk(child, false, ancestorRemainder); continue }  // nested series → flat sibling
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
          metadata: withAncestorRemainder(extractItemMetadata({ ...base, ...child.fields }, child.ownFields, false), ancestorRemainder),
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
        metadata: withAncestorRemainder(extractItemMetadata(base, n.ownFields, isRoot), ancestorRemainder),
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
          metadata: withAncestorRemainder(extractItemMetadata({ ...base, ...child.fields }, child.ownFields, false), ancestorRemainder),
        })
      }
    } else {
      // Container node. Root's own remainder is buildRoot's job (FileMetadata.extra) —
      // carrying it here too would emit it a second time on every descendant item.
      const ownRemainder = isRoot ? undefined : containerOwnRemainder(n.ownFields)
      const nextAncestorRemainder = ownRemainder ? { ...ancestorRemainder, ...ownRemainder } : ancestorRemainder
      n.instances.forEach(child => walk(child, false, nextAncestorRemainder))
    }
  }

  walk(tree, true, {})
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
  const { rawNode, body, convention } = loadFile(path, content)
  const fileSlug = pathToSlug(path)
  const tree = buildEffectiveTree(rawNode)
  const items = effectiveNodeToStoreItems(tree, fileSlug)
  return { items, root: { ...buildRoot(rawNode, body, nodeIsItem(tree)), fileConvention: convention } }
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
