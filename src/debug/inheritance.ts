/**
 * Pure implementation of the YAML Node Inheritance Model (spec v2.1).
 *
 * References:
 *   §1.3  Effective Node
 *   §1.4  Non-Inheritable Fields
 *   §2    The `defaults:` Block
 *   §3.1  Effective Node Computation
 *   §3.2  Merge Function
 */

import type { RawNode } from './nodeSchema'

// ── Field-origin tracking ─────────────────────────────────────────────────────

export interface FieldEntry {
  value: unknown
  /** true = came from an ancestor's defaults block; false = defined on this node */
  inherited: boolean
}

export interface EffectiveNodeResult {
  /** Breadcrumb path to this node, e.g. [] for root, ['instances','0'] for first child */
  path: string[]
  depth: number
  rawNode: RawNode
  /**
   * Effective fields, keyed by name.
   * Excludes `defaults` and `instances` — those are shown via metadata properties.
   */
  fields: Record<string, FieldEntry>
  /** True if this node carries its own `defaults:` block */
  hasDefaults: boolean
  /** Number of direct children (instances) */
  childCount: number
}

// ── Spec helpers ──────────────────────────────────────────────────────────────

/** Fields that must never appear in `defaults:` and never propagate (spec §1.4) */
const NON_INHERITABLE = new Set(['instances'])

/**
 * Sum type: a dict that carries a `type` key (spec §1.4 / §2.2).
 * When a child defines a sum type field, merge behaviour depends on whether
 * the `type` variant matches the inherited value.
 */
function isSumType(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    'type' in v
  )
}

/**
 * Product dict: a dict without a `type` key (spec §3.2).
 * Product dicts merge recursively; absent keys are preserved from the parent.
 */
function isProductDict(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    !('type' in v)
  )
}

// ── Core merge (spec §3.2) ────────────────────────────────────────────────────

/**
 * Merge `defaults` into `node`, returning effective fields with origin tracking.
 *
 * @param defaults  The effective defaults of the parent node (already resolved)
 * @param node      The raw child node
 * @returns         Map of field → {value, inherited}
 */
function mergeWithTracking(
  defaults: Record<string, unknown>,
  node: RawNode,
): Record<string, FieldEntry> {
  const result: Record<string, FieldEntry> = {}

  // Step 1: start with all inheritable defaults (spec §3.2 first loop)
  for (const [key, value] of Object.entries(defaults)) {
    if (NON_INHERITABLE.has(key)) continue
    result[key] = { value, inherited: true }
  }

  // Step 2: apply the node's own fields, overriding defaults (spec §3.2 second loop)
  for (const [key, value] of Object.entries(node)) {
    // `defaults` is handled separately (merged into effective_defaults, not effective node)
    if (key === 'defaults') continue
    // `instances` is attached separately, not mixed into fields
    if (key === 'instances') continue

    const parentEntry = result[key]
    const parentVal   = parentEntry?.value

    if (isSumType(value)) {
      if (isSumType(parentVal) && (value as any).type === (parentVal as any).type) {
        // Same variant — merge product keys (spec §2.2 same-type rule)
        const merged = mergeProductKeys(parentVal as Record<string, unknown>, value)
        result[key] = { value: merged, inherited: false }
      } else {
        // Different variant or no parent default — replace entirely (spec §2.2)
        result[key] = { value, inherited: false }
      }
    } else if (isProductDict(value) && isProductDict(parentVal)) {
      // Recurse for product dicts (spec §3.2)
      const merged = mergeProductKeys(parentVal, value)
      result[key] = { value: merged, inherited: false }
    } else {
      // Scalar or array — node wins (spec §3.2)
      result[key] = { value, inherited: false }
    }
  }

  return result
}

/**
 * Plain recursive product-dict merge (no origin tracking needed — used for
 * nested value merging inside sum type / product dict fields).
 */
function mergeProductKeys(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...parent }
  for (const [key, value] of Object.entries(child)) {
    const parentVal = result[key]
    if (isSumType(value)) {
      if (isSumType(parentVal) && (value as any).type === (parentVal as any).type) {
        result[key] = mergeProductKeys(parentVal as Record<string, unknown>, value)
      } else {
        result[key] = value
      }
    } else if (isProductDict(value) && isProductDict(parentVal)) {
      result[key] = mergeProductKeys(parentVal, value)
    } else {
      result[key] = value
    }
  }
  return result
}

// ── Effective defaults computation (spec §3.1) ────────────────────────────────

/**
 * Compute the effective defaults that `node` will pass to *its* children.
 *
 * effective_defaults(child) = merge(effective_defaults(parent), child.defaults ?? {})
 *
 * The merge here follows product-dict rules (no origin tracking needed — defaults
 * are not themselves displayed in the UI, only used to derive effective nodes).
 */
function computeEffectiveDefaults(
  parentEffectiveDefaults: Record<string, unknown>,
  node: RawNode,
): Record<string, unknown> {
  const nodeDefaults = (node.defaults as Record<string, unknown>) ?? {}
  // Merge: start with parent's effective defaults, apply child's own defaults
  const result: Record<string, unknown> = { ...parentEffectiveDefaults }
  for (const [key, value] of Object.entries(nodeDefaults)) {
    if (NON_INHERITABLE.has(key)) continue
    const parentVal = result[key]
    if (isSumType(value)) {
      if (isSumType(parentVal) && (value as any).type === (parentVal as any).type) {
        result[key] = mergeProductKeys(parentVal as Record<string, unknown>, value)
      } else {
        result[key] = value
      }
    } else if (isProductDict(value) && isProductDict(parentVal)) {
      result[key] = mergeProductKeys(parentVal, value)
    } else {
      result[key] = value
    }
  }
  return result
}

// ── Tree flattener ────────────────────────────────────────────────────────────

/**
 * Walk the node tree depth-first, computing effective fields at every node.
 *
 * The root node is its own effective self (no parent defaults to merge).
 * Each child is merged with its parent's effective defaults.
 */
export function flattenEffectiveNodes(
  node: RawNode,
  parentEffectiveDefaults: Record<string, unknown> = {},
  depth = 0,
  path: string[] = [],
): EffectiveNodeResult[] {
  const results: EffectiveNodeResult[] = []

  // Compute effective fields for this node
  const fields =
    depth === 0
      ? // Root: no parent defaults — all fields are "own"
        Object.fromEntries(
          Object.entries(node)
            .filter(([k]) => k !== 'defaults' && k !== 'instances')
            .map(([k, v]) => [k, { value: v, inherited: false } satisfies FieldEntry]),
        )
      : mergeWithTracking(parentEffectiveDefaults, node)

  const instances = Array.isArray(node.instances) ? node.instances as RawNode[] : []

  results.push({
    path,
    depth,
    rawNode: node,
    fields,
    hasDefaults: node.defaults !== undefined && node.defaults !== null,
    childCount: instances.length,
  })

  // Thread effective defaults down to children (spec §3.1)
  const myEffectiveDefaults = computeEffectiveDefaults(parentEffectiveDefaults, node)

  for (let i = 0; i < instances.length; i++) {
    const child = instances[i]
    const childPath = [...path, 'instances', String(i)]
    results.push(
      ...flattenEffectiveNodes(child, myEffectiveDefaults, depth + 1, childPath),
    )
  }

  return results
}

// ── Value serialiser (for display) ───────────────────────────────────────────

/** Convert an arbitrary field value to a compact, human-readable string. */
export function displayValue(v: unknown, indent = 0): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return v.includes(' ') || v === '' ? `"${v}"` : v
  if (Array.isArray(v)) return `[${v.map(x => displayValue(x)).join(', ')}]`
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return '{}'
    const pad = '  '.repeat(indent + 1)
    const inner = entries.map(([k, val]) => `${pad}${k}: ${displayValue(val, indent + 1)}`).join('\n')
    return `\n${inner}`
  }
  return String(v)
}
