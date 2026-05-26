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

// ── Collapse direction ────────────────────────────────────────────────────────

/** Structural equality for YAML values. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if ((a as unknown[]).length !== (b as unknown[]).length) return false
    return (a as unknown[]).every((v, i) => deepEqual(v, (b as unknown[])[i]))
  }
  if (
    typeof a === 'object' && a !== null && !Array.isArray(a) &&
    typeof b === 'object' && b !== null && !Array.isArray(b)
  ) {
    const ak = Object.keys(a as object).sort()
    const bk = Object.keys(b as object).sort()
    if (ak.length !== bk.length || !ak.every((k, i) => k === bk[i])) return false
    return ak.every(k =>
      deepEqual(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  }
  return false
}

/**
 * Given the full expansion results, compute the most compact YAML
 * representation: field values that are identical across ALL depth-1
 * instances become `defaults:`, each instance keeps only its unique overrides.
 *
 * Root own fields (outside `defaults`/`instances`) are preserved as-is.
 * Nested instances inside each direct child are preserved from its rawNode.
 *
 * @param results       Output of flattenEffectiveNodes (includes root at index 0)
 * @param originalBody  Markdown body from the original file (preserved verbatim)
 */
export function collapseToYaml(
  results: EffectiveNodeResult[],
  originalBody = '',
): string {
  const root = results[0]
  if (!root) return ''

  const directChildren = results.filter(r => r.depth === 1)

  if (directChildren.length === 0) {
    // No instances — serialise root as-is
    return yamlFrontmatter(root.rawNode, {}, [], originalBody)
  }

  // ── Find fields whose value is identical across ALL direct children ────────
  const allKeys = new Set<string>()
  for (const child of directChildren) {
    for (const key of Object.keys(child.fields)) allKeys.add(key)
  }

  const sharedDefaults: Record<string, unknown> = {}
  for (const key of allKeys) {
    const entries = directChildren.map(c => c.fields[key])
    if (!entries.every(e => e !== undefined)) continue   // missing in some
    const firstVal = entries[0].value
    if (entries.every(e => deepEqual(e.value, firstVal))) {
      sharedDefaults[key] = firstVal
    }
  }

  // ── Build collapsed instances: only non-default fields remain ─────────────
  const collapsedInstances = directChildren.map(child => {
    const inst: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(child.fields)) {
      if (key in sharedDefaults && deepEqual(entry.value, sharedDefaults[key])) continue
      inst[key] = entry.value
    }
    // Preserve the child's own nested instances and defaults from its rawNode
    if (child.rawNode.instances !== undefined) inst.instances = child.rawNode.instances
    if (child.rawNode.defaults  !== undefined) inst.defaults  = child.rawNode.defaults
    return inst
  })

  return yamlFrontmatter(root.rawNode, sharedDefaults, collapsedInstances, originalBody)
}

// ── YAML serialiser ───────────────────────────────────────────────────────────

/** Quote a string value if YAML would misparse it as another type. */
function quoteStr(s: string): string {
  if (
    s === '' ||
    s === 'null' || s === 'true' || s === 'false' ||
    /^[-+]?[0-9]/.test(s) ||
    /[:#\[\]{}&*!,|>'"\\]/.test(s) ||
    s.includes(': ') || s.endsWith(':') ||
    s.startsWith(' ') || s.endsWith(' ')
  ) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return s
}

/** Serialize a scalar or inline-array value to a YAML value token. */
function inlineVal(v: unknown): string | null {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number') return String(v)
  if (typeof v === 'string') return quoteStr(v)
  if (Array.isArray(v)) {
    if ((v as unknown[]).every(x => x === null || typeof x !== 'object')) {
      return `[${(v as unknown[]).map(x => inlineVal(x)).join(', ')}]`
    }
    return null // needs block form
  }
  return null // object → needs block form
}

/**
 * Recursively serialize a value as indented YAML lines.
 * `indent` is the number of leading spaces for this level's keys.
 */
function valueLines(v: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent)

  if (Array.isArray(v)) {
    const out: string[] = []
    for (const item of v as unknown[]) {
      if (item === null || typeof item !== 'object') {
        out.push(`${pad}- ${inlineVal(item)}`)
      } else {
        // Object list item: first key gets `- `, rest get `  `
        const entries = Object.entries(item as Record<string, unknown>)
        entries.forEach(([k, val], idx) => {
          const pfx = idx === 0 ? `${pad}- ` : `${pad}  `
          const iv = inlineVal(val)
          if (iv !== null) {
            out.push(`${pfx}${k}: ${iv}`)
          } else {
            out.push(`${pfx}${k}:`)
            out.push(...valueLines(val, indent + 4))
          }
        })
      }
    }
    return out
  }

  if (typeof v === 'object' && v !== null) {
    const out: string[] = []
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const iv = inlineVal(val)
      if (iv !== null) {
        out.push(`${pad}${k}: ${iv}`)
      } else {
        out.push(`${pad}${k}:`)
        out.push(...valueLines(val, indent + 2))
      }
    }
    return out
  }

  return [inlineVal(v) ?? String(v)]
}

/**
 * Serialize a root node + computed defaults + collapsed instances to YAML
 * frontmatter (with `---` delimiters) plus an optional markdown body.
 */
function yamlFrontmatter(
  rootRawNode: RawNode,
  defaults: Record<string, unknown>,
  instances: Record<string, unknown>[],
  body: string,
): string {
  const lines: string[] = ['---']

  // Root own fields
  for (const [key, value] of Object.entries(rootRawNode)) {
    if (key === 'defaults' || key === 'instances') continue
    const iv = inlineVal(value)
    if (iv !== null) {
      lines.push(`${key}: ${iv}`)
    } else {
      lines.push(`${key}:`)
      lines.push(...valueLines(value, 2))
    }
  }

  // defaults: block
  if (Object.keys(defaults).length > 0) {
    lines.push('defaults:')
    for (const [key, value] of Object.entries(defaults)) {
      const iv = inlineVal(value)
      if (iv !== null) {
        lines.push(`  ${key}: ${iv}`)
      } else {
        lines.push(`  ${key}:`)
        lines.push(...valueLines(value, 4))
      }
    }
  }

  // instances: block
  if (instances.length > 0) {
    lines.push('instances:')
    for (const inst of instances) {
      const entries = Object.entries(inst)
      if (entries.length === 0) { lines.push('  - {}'); continue }

      entries.forEach(([key, value], idx) => {
        const pfx    = idx === 0 ? '  - ' : '    '
        const subInd = idx === 0 ? 6 : 6   // both need 6-space children

        if (key === 'instances' && Array.isArray(value)) {
          lines.push(`${pfx}instances:`)
          lines.push(...valueLines(value, subInd))
        } else if (key === 'defaults' && typeof value === 'object' && value !== null) {
          lines.push(`${pfx}defaults:`)
          lines.push(...valueLines(value, subInd))
        } else {
          const iv = inlineVal(value)
          if (iv !== null) {
            lines.push(`${pfx}${key}: ${iv}`)
          } else {
            lines.push(`${pfx}${key}:`)
            lines.push(...valueLines(value, subInd))
          }
        }
      })
    }
  }

  lines.push('---')
  if (body) lines.push('', body)
  return lines.join('\n')
}
