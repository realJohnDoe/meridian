/**
 * Pure implementation of the YAML Node Inheritance Model (spec v2.1).
 *
 * Output: EffectiveNode tree.
 *  - All `defaults:` values are merged into child fields and the block disappears.
 *  - `instances` becomes a typed array of EffectiveNode children.
 *  - Fields carry plain values — no origin tracking.
 */

import type { RawNode } from './nodeSchema'

// ── Output type ───────────────────────────────────────────────────────────────

/**
 * A node after inheritance has been fully applied.
 * The `defaults:` block is consumed — it does not appear here.
 * Each child in `instances` is already resolved with inherited values.
 */
export interface EffectiveNode {
  fields:    Record<string, unknown>
  instances: EffectiveNode[]
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

  return { fields, instances }
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

// ── Collapse direction ────────────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, (b as unknown[])[i]))
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

/** Field values that are identical across ALL instances → shared defaults. */
function computeSharedDefaults(instances: EffectiveNode[]): Record<string, unknown> {
  if (instances.length === 0) return {}
  const allKeys = new Set<string>()
  for (const child of instances) {
    for (const key of Object.keys(child.fields)) allKeys.add(key)
  }
  const shared: Record<string, unknown> = {}
  for (const key of allKeys) {
    const values = instances.map(c => c.fields[key])
    if (!values.every(v => v !== undefined)) continue
    const first = values[0]
    if (values.every(v => deepEqual(v, first))) shared[key] = first
  }
  return shared
}

/**
 * Build the collapsed plain-object for a single instance:
 * strips fields already covered by the parent's shared defaults,
 * and recursively collapses any sub-instances.
 */
function collapseInstance(
  node: EffectiveNode,
  shared: Record<string, unknown>,
): Record<string, unknown> {
  const inst: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(node.fields)) {
    if (key in shared && deepEqual(value, shared[key])) continue
    inst[key] = value
  }

  if (node.instances.length > 0) {
    const nestedShared = computeSharedDefaults(node.instances)
    if (Object.keys(nestedShared).length > 0) inst.defaults  = nestedShared
    inst.instances = node.instances.map(gc => collapseInstance(gc, nestedShared))
  }

  return inst
}

/**
 * Collapse an EffectiveNode tree back to the most compact YAML representation.
 * Fields shared across all direct instances become `defaults:`.
 */
export function collapseToYaml(root: EffectiveNode, body = ''): string {
  const shared    = computeSharedDefaults(root.instances)
  const instances = root.instances.map(child => collapseInstance(child, shared))
  return yamlFrontmatter(root.fields, shared, instances, body)
}

// ── YAML serialiser ───────────────────────────────────────────────────────────

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

function inlineVal(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'number')  return String(v)
  if (typeof v === 'string')  return quoteStr(v)
  if (Array.isArray(v)) {
    if ((v as unknown[]).every(x => x === null || typeof x !== 'object')) {
      return `[${(v as unknown[]).map(x => inlineVal(x)).join(', ')}]`
    }
    return null
  }
  return null
}

function valueLines(v: unknown, indent: number): string[] {
  const pad = ' '.repeat(indent)

  if (Array.isArray(v)) {
    const out: string[] = []
    for (const item of v as unknown[]) {
      if (item === null || typeof item !== 'object') {
        out.push(`${pad}- ${inlineVal(item)}`)
      } else {
        const entries = Object.entries(item as Record<string, unknown>)
        entries.forEach(([k, val], idx) => {
          const pfx = idx === 0 ? `${pad}- ` : `${pad}  `
          const iv  = inlineVal(val)
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
      if (val === null || val === undefined) continue
      if (Array.isArray(val) && val.length === 0) continue
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
 * Serialize a RawNode directly to YAML frontmatter, preserving its structure
 * (defaults, instances) without any collapse optimisation.
 */
export function serializeRawNode(node: RawNode, body = ''): string {
  const rootFields = Object.fromEntries(
    Object.entries(node).filter(([k]) => k !== 'defaults' && k !== 'instances'),
  )
  const defaults  = (node.defaults  as Record<string, unknown>) ?? {}
  const instances = Array.isArray(node.instances)
    ? (node.instances as Record<string, unknown>[])
    : []
  return yamlFrontmatter(rootFields, defaults, instances, body)
}

function yamlFrontmatter(
  rootFields: Record<string, unknown>,
  defaults:   Record<string, unknown>,
  instances:  Record<string, unknown>[],
  body:       string,
): string {
  const lines: string[] = ['---']

  // Root fields
  for (const [key, value] of Object.entries(rootFields)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
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
      if (value === null || value === undefined) continue
      if (Array.isArray(value) && value.length === 0) continue
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
        if (value === null || value === undefined) return
        if (Array.isArray(value) && value.length === 0) return
        const pfx    = idx === 0 ? '  - ' : '    '
        const subInd = 6

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
