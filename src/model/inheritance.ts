/**
 * Pure implementation of the YAML Node Inheritance Model (spec v2.1).
 *
 * Output: EffectiveNode tree.
 *  - All `defaults:` values are merged into child fields and the block disappears.
 *  - `instances` becomes a typed array of EffectiveNode children.
 *  - Fields carry plain values — no origin tracking.
 */

import { stringify } from 'yaml'
import { wrapFrontmatter, isRawScalar, rawScalarTag, rawScalarValue } from '@/fileIO'
import type { FileConvention } from '@/fileIO'
import type { RawNode } from './nodeSchema'

// ── Output type ───────────────────────────────────────────────────────────────

/**
 * A node after inheritance has been fully applied.
 * The `defaults:` block is consumed — it does not appear here.
 * Each child in `instances` is already resolved with inherited values.
 *
 * `childDefaults` holds the accumulated defaults that were passed down to
 * this node's children (parent accumulated + this node's own `defaults:`).
 * The expansion engine uses this to seed generated occurrences, which are
 * semantically equivalent to virtual children with only a date override.
 *
 * `ownFields` holds this node's own explicit properties (everything except
 * `defaults`/`instances`), *before* `parentDefaults` merging — i.e. exactly
 * what distinguishes this node from a copy that inherited everything. A
 * container node (no `date`, no `repeat`) never becomes a `StoreItem` of its
 * own, so `fields` (which already has `parentDefaults` folded in) has no home
 * to reach at collapse time; `storeItems.ts` uses `ownFields` to recover a
 * container's own remainder and carry it down to its descendant items instead
 * of silently discarding it — still field-agnostic here, since this is purely
 * "own vs. inherited" bookkeeping, not a name any domain field would use.
 *
 * **Intended scope:** this type is an implementation detail of the parse
 * pipeline (`storeItems.ts`). It is exported only so that
 * `NodeInheritanceDebugger` can visualise the inheritance tree. Production
 * code should depend on `StoreItem[]` (via `parseToStoreItems`) instead.
 */
export interface EffectiveNode {
  fields:        Record<string, unknown>
  childDefaults: Record<string, unknown>
  instances:     EffectiveNode[]
  ownFields:     Record<string, unknown>
}

// ── Spec helpers ──────────────────────────────────────────────────────────────

/** Fields that must never be inherited (spec §1.4). */
const NON_INHERITABLE = new Set(['instances'])

function isSumType(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'type' in v
}

function isProductDict(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !('type' in v)
}

// ── Merge helpers (spec §3.2) ─────────────────────────────────────────────────

function mergeObjects(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...parent }
  for (const [key, value] of Object.entries(child)) {
    result[key] = mergeValue(result[key], value)
  }
  return result
}

/**
 * Merge a child value on top of a parent value following spec §3.2.
 * When `parent` is undefined the child wins outright.
 */
function mergeValue(parent: unknown, child: unknown): unknown {
  if (parent === undefined) return child
  // A `RawScalar` is a scalar wearing an object's clothes: it is `typeof
  // 'object'` and carries a `style` field, so without this it would fall into
  // the product-dict branch below and two of them would be merged key-by-key
  // into a plain object holding neither one's source. A scalar always replaces
  // a scalar, which is what the final `return child` says for every other one.
  if (isRawScalar(child) || isRawScalar(parent)) return child
  if (isSumType(child)) {
    return isSumType(parent) && child.type === parent.type
      ? mergeObjects(parent, child)
      : child
  }
  if (isProductDict(child) && isProductDict(parent)) {
    return mergeObjects(parent, child)
  }
  return child
}

// ── Effective defaults (spec §3.1) ────────────────────────────────────────────

/**
 * Compute the effective defaults this node passes to its children:
 * parent's accumulated defaults merged with this node's own `defaults:` block.
 */
function childDefaults(
  parentDefaults: Record<string, unknown>,
  node: RawNode,
): Record<string, unknown> {
  const own = node.defaults ?? {}
  const filtered = Object.fromEntries(
    Object.entries(own).filter(([k]) => !NON_INHERITABLE.has(k)),
  )
  return mergeObjects(parentDefaults, filtered)
}

// ── Tree builder ──────────────────────────────────────────────────────────────

/**
 * Recursively build the effective node tree.
 *
 * `defaults:` is consumed at every level — children's fields are fully merged
 * with accumulated parent defaults before being returned.
 *
 * See `EffectiveNode` for intended scope: exported for the debug view only.
 * The canonical entry point for all other callers is `parseToStoreItems`.
 */
export function buildEffectiveTree(
  node: RawNode,
  parentDefaults: Record<string, unknown> = {},
): EffectiveNode {
  // 1. Start with inheritable parent defaults
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parentDefaults)) {
    if (!NON_INHERITABLE.has(key)) fields[key] = value
  }

  // 2. Apply this node's own fields on top (spec merge rules), tracking which
  // keys were this node's own (see `EffectiveNode.ownFields`).
  const ownFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    if (key === 'defaults' || key === 'instances') continue
    fields[key] = mergeValue(fields[key], value)
    ownFields[key] = value
  }

  // 3. Recurse into instances, passing down the effective defaults
  const accumulated = childDefaults(parentDefaults, node)
  const rawInstances = Array.isArray(node.instances) ? node.instances : []
  const instances    = rawInstances.map(child => buildEffectiveTree(child, accumulated))

  return { fields, childDefaults: accumulated, instances, ownFields }
}

// ── Value display ─────────────────────────────────────────────────────────────

/** Convert an arbitrary field value to a compact, human-readable string. */
export function displayValue(v: unknown, indent = 0): string {
  // A preserved scalar displays as the value it stands for, not as its box.
  if (isRawScalar(v)) return displayValue(rawScalarValue(v), indent)
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number')  return String(v)
  if (typeof v === 'string')  return v.includes(' ') || v === '' ? `"${v}"` : v
  if (Array.isArray(v)) return `[${v.map(x => displayValue(x)).join(', ')}]`
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const pad   = '  '.repeat(indent + 1)
    const inner = entries.map(([k, val]) => `${pad}${k}: ${displayValue(val, indent + 1)}`).join('\n')
    return `\n${inner}`
  }
  // Only function/symbol/bigint remain here — all have meaningful, non-'[object
  // Object]' string forms, unlike the plain-object case already handled above.
  // eslint-disable-next-line @typescript-eslint/no-base-to-string
  return String(v)
}

// ── Collapse direction (removed) ──────────────────────────────────────────────
// collapseToYaml(EffectiveNode), collapseInstance, computeSharedDefaults,
// canonicaliseInstance were all deleted — collapse is now done by
// src/model/collapse.ts operating on StoreItem[], which is the canonical
// serialization path for both the main app and the debug view.

// ── YAML serialiser ───────────────────────────────────────────────────────────

/**
 * Recursively drop `undefined` values so the emitted frontmatter stays free of
 * `key: null` noise from fields the model left unset.
 *
 * `null` and `[]` are deliberately NOT dropped: an unknown key holding an
 * explicit `reviewer: null` or `aliases: []` is user-authored data, and by the
 * time this runs it is indistinguishable from a model field. Model fields never
 * reach here empty anyway — `inlineFieldEmpty` suppresses them upstream in
 * collapse.ts.
 */
function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune)
  // A `RawScalar` is a leaf, not a bag of fields: walking into it would shred
  // it into a plain `{source, style, value}` mapping and emit *that* — the
  // same character-explosion shape a mistyped `defaults:` produces.
  if (isRawScalar(v)) return v
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue
      out[k] = prune(val)
    }
    return out
  }
  return v
}

/**
 * Serialize a RawNode to YAML fields, preserving its structure (defaults,
 * instances) without any collapse optimisation. Returns only the inner YAML
 * content — wrap with `wrapFrontmatter` from fileIO.ts.
 *
 * Key order is canonicalised: `defaults:` first (when present), then root
 * fields, then `instances:`. Putting defaults first makes series files
 * read top-to-bottom as "here are the defaults, here is the schedule".
 */
function serializeRawNode(node: RawNode): string {
  const { defaults, instances, ...rootFields } = node
  const ordered: Record<string, unknown> = {}
  if (defaults && Object.keys(defaults).length > 0) ordered.defaults = defaults
  Object.assign(ordered, rootFields)
  if (Array.isArray(instances) && instances.length > 0) ordered.instances = instances

  return stringify(prune(ordered), {
    lineWidth: 0,            // never wrap long scalars (e.g. titles, intervals)
    nullStr: 'null',
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
    // Teaches the serialiser to write a `RawScalar` back as the characters its
    // file held. Registered here rather than globally because this is the one
    // place Meridian turns an object graph into frontmatter.
    customTags: [rawScalarTag],
    // Frontmatter this app writes has no anchors — model/AGENTS.md lists them
    // as a non-goal, and a file that arrives with one has already been expanded
    // to copies by the time it reaches here. Without this, the serialiser mints
    // `&a1`/`*a1` for any value it sees the same *reference* to twice, and one
    // bag of extras spread onto several items (`withAncestorRemainder`) shares
    // its references — so a plain `[1, 2]` under an unknown key on two
    // occurrences already emits an anchor pair into the user's file today.
    // Note this cannot make a circular graph recurse forever: `prune` above
    // walks the same graph with no cycle guard and would overflow first.
    aliasDuplicateObjects: false,
  }).trimEnd()
}

/** Serialise a raw node + body into a full file string (frontmatter + body). */
export function saveFile(rawNode: Record<string, unknown>, body: string, convention?: FileConvention): string {
  return wrapFrontmatter(serializeRawNode(rawNode), body, convention)
}
