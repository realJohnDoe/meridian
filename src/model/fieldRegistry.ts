// ── INLINE-FIELD REGISTRY ────────────────────────────────────────────────────
// The YAML parse/coercion runtime for persisted (frontmatter) metadata: the
// single source of truth for which fields exist, what shape each holds, and how
// a raw YAML value becomes a typed one. Lives in model/ because model/ is the
// only consumer — storeItems, collapse, expansion, inheritance, dateUtils,
// duration and roundTripCheck. Deliberately NOT exported from model/index.ts:
// this is the domain core's internals, not its public surface.

import type { FileMetadata, FileFields, OccurrenceMetadata, Priority } from '@/types'

const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low']

// `level` distinguishes file-level fields (on the root, shared by all
// occurrences) from occurrence-level fields (per series/occurrence).

export type InlineFieldKind = 'string' | 'boolean' | 'priority' | 'stringArray'

interface InlineFieldSpec {
  key:    keyof (FileMetadata & OccurrenceMetadata)
  kind:   InlineFieldKind
  level:  'file' | 'occurrence'
  /** Required fields get a non-undefined default ('' or []) when absent from raw. */
  required?: boolean
}

const INLINE_FIELDS: readonly InlineFieldSpec[] = [
  { key: 'title',        kind: 'string',      level: 'file',       required: true },
  { key: 'tags',         kind: 'stringArray', level: 'file',       required: true },
  { key: 'items',        kind: 'stringArray', level: 'file',       required: true },
  // Not `required`: unlike title/tags/items, an absent key and an explicit
  // `false` must read back identically as "not archived" AND still round-trip
  // a hand-written `false` — see FileMetadata.archived's doc comment.
  { key: 'archived',     kind: 'boolean',     level: 'file' },
  { key: 'done',         kind: 'boolean',     level: 'occurrence' },
  { key: 'participants', kind: 'stringArray', level: 'occurrence', required: true },
  { key: 'priority',     kind: 'priority',    level: 'occurrence' },
  { key: 'duration',     kind: 'string',      level: 'occurrence' },
  { key: 'timezone',     kind: 'string',      level: 'occurrence' },
]

/** Occurrence-level inline field specs only (used by collapse/storeOps). */
export const OCCURRENCE_FIELDS = INLINE_FIELDS.filter(s => s.level === 'occurrence')

/** File-level inline field specs (derived from level; replaces FILE_LEVEL_FIELDS). */
export const FILE_LEVEL_SPECS = INLINE_FIELDS.filter(s => s.level === 'file')

// ── Unknown-key preservation ──────────────────────────────────────────────────
// Everything outside this vocabulary is carried verbatim in an `extra` bag so a
// save never deletes frontmatter the model has no name for. See
// src/model/AGENTS.md for the ownership rule and the exactly-once guarantee.

/** Keys the YAML shape itself owns — never metadata, never part of `extra`. */
export const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  'date', 'time', 'repeat', 'excluded', 'instances', 'defaults',
])

/** Structural keys plus every registry key, at both levels. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...STRUCTURAL_KEYS,
  ...INLINE_FIELDS.map(s => s.key as string),
])

/**
 * Structural equality for arbitrary YAML values. `inlineFieldEqual` is `a === b`
 * for non-array kinds, which cannot compare the nested mappings and sequences an
 * unknown key may hold.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ae = Object.entries(a as Record<string, unknown>)
  const be = b as Record<string, unknown>
  if (ae.length !== Object.keys(be).length) return false
  return ae.every(([k, v]) => k in be && deepEqual(v, be[k]))
}

/**
 * The remainder of a node: every key outside the reserved vocabulary.
 * Returns `undefined` rather than `{}` when there is nothing to carry, so files
 * without unknown keys keep metadata objects byte-identical to before.
 */
export function unknownKeys(fields: Record<string, unknown>): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) {
    if (!RESERVED_KEYS.has(k)) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Value equality for an inline field, comparing array fields structurally. */
export function inlineFieldEqual(kind: InlineFieldKind, a: unknown, b: unknown): boolean {
  return kind === 'stringArray' ? JSON.stringify(a) === JSON.stringify(b) : a === b
}

/** True when a value should be omitted from serialized YAML (undefined, or empty array). */
export function inlineFieldEmpty(kind: InlineFieldKind, v: unknown): boolean {
  if (v === undefined) return true
  return kind === 'stringArray' ? !Array.isArray(v) || v.length === 0 : false
}

// ── Metadata extraction ───────────────────────────────────────────────────────

/**
 * Coerce a raw YAML value expected to be scalar text to a string. Malformed
 * frontmatter (e.g. a nested mapping where a plain string was expected)
 * yields `undefined` instead of silently stringifying to `[object Object]`.
 */
export function scalarToString(v: unknown): string | undefined {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return undefined
}

/** Coerce a raw YAML value to the typed value for `spec`. */
/**
 * Only `kind` and `required` decide how a raw value is coerced, so this takes
 * the two fields structurally rather than the whole spec — which lets
 * `absentFieldValue` below be exported without exporting `InlineFieldSpec`.
 */
type FieldShape = { kind: InlineFieldKind; required?: boolean }

function parseInlineField(spec: FieldShape, raw: unknown): unknown {
  switch (spec.kind) {
    // An explicit YAML `null` means "this node has no value here" — which is
    // NOT the same as the key being absent, since an absent key inherits from
    // `defaults:` while `null` deliberately overrides it with nothing. Mapping
    // it to `undefined` is what makes an occurrence that stopped being a task
    // read back as untracked rather than as a third, meaningless state
    // (`done: null` used to survive as literal null, and `isTracked`'s
    // `!== undefined` then called it a task). See the data-integrity survey,
    // finding #2a-ii. A value of the wrong shape (a string, a number, an
    // unrecognised priority word) collapses the same way `null` does — the
    // typed field stays honest, and `malformedKnownFields` below routes the
    // original value into `extra` so it still round-trips (health survey
    // finding #1).
    case 'boolean':     return typeof raw === 'boolean' ? raw : undefined
    case 'priority':    return typeof raw === 'string' && (PRIORITIES as readonly string[]).includes(raw) ? raw : undefined
    // Each element is coerced independently, same rule as the `string` kind
    // below: a bare number/boolean is text that happens to look like one and
    // is kept, a nested mapping/sequence can't be represented as a string and
    // is dropped from the typed array (the untouched raw array still
    // round-trips via `extra` — see `malformedKnownFields`).
    case 'stringArray': return Array.isArray(raw)
      ? raw.map(scalarToString).filter((s): s is string => s !== undefined)
      : (spec.required ? [] : undefined)
    case 'string':      return scalarToString(raw) ?? (spec.required ? '' : undefined)
  }
}

/**
 * The value a field reads back as when its key is absent from the YAML —
 * `[]`/`''` for a required field, `undefined` otherwise.
 *
 * This is half of the emit decision in `collapse.ts`: a key is only safe to
 * omit when omitting it round-trips to the value the node actually holds, and
 * for a node that inherits nothing, "what omitting gives you" is exactly this.
 */
export function absentFieldValue(spec: FieldShape): unknown {
  return parseInlineField(spec, undefined)
}

/**
 * Route a known field's raw value into `extra` when its shape didn't match the
 * registry's expected kind (e.g. `duration: [1, 2]`, `tags: "not-a-list"`,
 * `done: "yes-please"`, `priority: 7`, an `items` array holding a nested
 * mapping), instead of silently discarding it. The typed field still falls
 * back to its usual `undefined`/`''`/`[]`/filtered-array — domain types stay
 * honest — but the raw value survives a save under its own key, and
 * `fileMetaToYaml`/`occMetaToYaml` prefer it over the typed fallback on
 * emission.
 *
 * An explicit YAML `null` is never malformed for any kind — see the
 * null-handling note on `parseInlineField` — so every branch below excludes it.
 */
function malformedKnownFields(
  fields: Record<string, unknown>,
  specs: readonly InlineFieldSpec[],
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {}
  for (const spec of specs) {
    const raw = fields[spec.key]
    if (raw === undefined || raw === null) continue
    const malformed = spec.kind === 'string'      ? scalarToString(raw) === undefined
      : spec.kind === 'stringArray' ? !Array.isArray(raw) || raw.some(el => scalarToString(el) === undefined)
      : spec.kind === 'boolean'     ? typeof raw !== 'boolean'
      : !(PRIORITIES as readonly unknown[]).includes(raw)
    if (malformed) out[spec.key] = raw
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/** Merge two optional bags into one, or `undefined` when both are empty. */
function mergeBags(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return a || b ? { ...a, ...b } : undefined
}

/**
 * Extract file-level metadata from raw YAML fields.
 *
 * `remainder` is the file's unknown-key bag. The caller supplies it because only
 * the parse pipeline knows whether the file root is itself an item (in which
 * case the root's unknown keys belong to that item, not to the file).
 */
export function extractFileMetadata(
  fields: Record<string, unknown>,
  remainder?: Record<string, unknown>,
): FileFields {
  // title/tags/items go through the same per-field/per-element coercion as
  // extractOccurrenceMetadata below — this used to hand-roll its own
  // Array.isArray(...) ? raw : [] check, which (unlike parseInlineField)
  // never validated array ELEMENTS, so a malformed `items:` list reached
  // `root.items` — the exact map wikilinks.ts/fileOccurrence.ts iterate —
  // untouched (health survey finding #1).
  const meta = { body: scalarToString(fields.body) } as unknown as FileFields
  const sink = meta as unknown as Record<string, unknown>
  for (const spec of FILE_LEVEL_SPECS) {
    sink[spec.key as string] = parseInlineField(spec, fields[spec.key])
  }
  const extra = mergeBags(remainder, malformedKnownFields(fields, FILE_LEVEL_SPECS))
  if (extra) meta.extra = extra
  return meta
}

/** Extract occurrence-level metadata from the raw fields of a node or occurrence. */
export function extractOccurrenceMetadata(fields: Record<string, unknown>): OccurrenceMetadata {
  const meta = {} as OccurrenceMetadata
  const sink = meta as unknown as Record<string, unknown>
  for (const spec of OCCURRENCE_FIELDS) {
    sink[spec.key] = parseInlineField(spec, fields[spec.key])
  }
  const extra = mergeBags(unknownKeys(fields), malformedKnownFields(fields, OCCURRENCE_FIELDS))
  if (extra) meta.extra = extra
  return meta
}
