/**
 * Pure implementation of the YAML Node Inheritance Model (spec v2.1).
 *
 * Output: EffectiveNode tree.
 *  - All `defaults:` values are merged into child fields and the block disappears.
 *  - `instances` becomes a typed array of EffectiveNode children.
 *  - Fields carry plain values — no origin tracking.
 */

import { stringify } from 'yaml'
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
 */
export interface EffectiveNode {
  fields:        Record<string, unknown>
  childDefaults: Record<string, unknown>
  instances:     EffectiveNode[]
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
  if (isSumType(child)) {
    return isSumType(parent) && (child as Record<string, unknown>).type === (parent as Record<string, unknown>).type
      ? mergeObjects(parent as Record<string, unknown>, child)
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
  const own = (node.defaults as Record<string, unknown>) ?? {}
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

  // 2. Apply this node's own fields on top (spec merge rules)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'defaults' || key === 'instances') continue
    fields[key] = mergeValue(fields[key], value)
  }

  // 3. Recurse into instances, passing down the effective defaults
  const accumulated = childDefaults(parentDefaults, node)
  const rawInstances = Array.isArray(node.instances) ? (node.instances as RawNode[]) : []
  const instances    = rawInstances.map(child => buildEffectiveTree(child, accumulated))

  return { fields, childDefaults: accumulated, instances }
}

// ── Value display ─────────────────────────────────────────────────────────────

/** Convert an arbitrary field value to a compact, human-readable string. */
export function displayValue(v: unknown, indent = 0): string {
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
  return String(v)
}

// ── Collapse direction (removed) ──────────────────────────────────────────────
// collapseToYaml(EffectiveNode), collapseInstance, computeSharedDefaults,
// canonicaliseInstance were all deleted — collapse is now done by
// src/model/collapse.ts operating on StoreItem[], which is the canonical
// serialization path for both the main app and the debug view.

// ── YAML serialiser ───────────────────────────────────────────────────────────

/**
 * Recursively drop `null`/`undefined` values and empty arrays so the emitted
 * frontmatter stays free of `key: null` / `key: []` noise — matching the
 * behaviour callers relied on from the previous hand-rolled serialiser.
 */
function prune(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(prune)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === undefined) continue
      if (Array.isArray(val) && val.length === 0) continue
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
export function serializeRawNode(node: RawNode): string {
  const { defaults, instances, ...rootFields } = node
  const ordered: Record<string, unknown> = {}
  if (defaults && Object.keys(defaults as object).length > 0) ordered.defaults = defaults
  Object.assign(ordered, rootFields)
  if (Array.isArray(instances) && instances.length > 0) ordered.instances = instances

  return stringify(prune(ordered), {
    lineWidth: 0,            // never wrap long scalars (e.g. titles, intervals)
    nullStr: 'null',
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN',
  }).trimEnd()
}
