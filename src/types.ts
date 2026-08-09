// ── MERIDIAN DOMAIN TYPES ────────────────────────────────────────────────────

import type { FileConvention } from '@/fileIO'

export type Priority = 'high' | 'medium' | 'low'
const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low']

export type Weekday = 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa' | 'su'

// ── Repeat ───────────────────────────────────────────────────────────────────

type RepeatEnd =
  | { type: 'until'; date?: string; time?: string }
  | { type: 'count'; occurrences: number }

export type Repeat =
  | { type: 'schedule'; freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; byweekday?: Weekday[]; bymonthday?: number[]; bysetpos?: number; interval?: number; end?: RepeatEnd }
  | { type: 'after_completion'; interval: string; end?: RepeatEnd }

// ── Metadata types ────────────────────────────────────────────────────────────

/**
 * File-level fields — persisted at the frontmatter root; shared by all
 * occurrences in the file. `body` is markdown, not YAML frontmatter.
 * Stored in the roots map (Map<fileSlug, FileMetadata>), not on StoreItems.
 */
export interface FileMetadata {
  title: string
  tags:  string[]
  items: string[]
  body?: string
  /**
   * Frontmatter keys the model has no name for, kept verbatim so a save never
   * deletes hand-authored data. Owned by the file root ONLY when the root node
   * is not itself an item — see `nodeIsItem` in model/storeItems.ts.
   */
  extra?: Record<string, unknown>
  /**
   * The source file's line-ending / trailing-newline convention, captured at
   * parse time so a save doesn't rewrite every `\r` just because one field
   * changed (data-integrity survey, finding #8). `undefined` for a
   * freshly-created entry with no source file yet — `saveFile` then falls
   * back to `DEFAULT_FILE_CONVENTION`. Never user-editable, so it is carried
   * forward across edits the same way `extra` is — see `updateRoot` in
   * `storeOps.ts`; forgetting to would silently revert the file to LF the
   * moment the user makes their first edit through the app.
   */
  fileConvention?: FileConvention
}

/**
 * Occurrence-level fields — persisted per series or occurrence.
 * Raw store items (StoreItem) carry this type; it has no file-level fields.
 */
export interface OccurrenceMetadata {
  done?:        boolean
  participants: string[]
  priority?:    Priority
  duration?:    string
  timezone?:    string
  /** Unknown frontmatter keys for this node — see FileMetadata.extra. */
  extra?:       Record<string, unknown>
}

/** Fields never persisted to YAML — computed at runtime or used only by the UI. */
interface ExtendedMetadata {
  jsTime?: Date    // computed from date+time; undefined in raw store items
}

/**
 * Full metadata on an EXPANDED occurrence (file-level joined back from roots).
 * Raw store items carry OccurrenceMetadata only; AppMetadata only appears after
 * expandRange has joined the file-level fields.
 */
/*
 * `extra` is Omit-ted from the file half deliberately: joinFileMeta spreads the
 * root under the occurrence metadata, so without this an occurrence carrying no
 * extras of its own would inherit the FILE's extras — and the edit path would
 * then write them back as occurrence-level keys, emitting them twice.
 * AppMetadata.extra is always the occurrence bag.
 */
export type AppMetadata = OccurrenceMetadata & Omit<FileMetadata, 'extra'> & ExtendedMetadata

// ── Expansion model types ─────────────────────────────────────────────────────

/**
 * A concrete resolved occurrence (single point in time).
 * `T` is the metadata type defined by the caller.
 */
export interface OccurrenceEntry<T = Record<string, unknown>> {
  date:      string                    // YYYY-MM-DD
  time:      string | null             // HH:mm or null
  source:    'generated' | 'explicit'
  fileSlug:  string                    // identifies source file (= node.id)
  id:        string                    // stable UUID — carried from the store item or memoised by logical key
  ownerId?:  string                    // UUID of parent RepeatPattern (undefined for standalone)
  excluded?: boolean                   // exclusion override: suppresses a generated occurrence
  metadata:  T
}

/**
 * A recurring series node — produces OccurrenceEntry values via expansion.
 * `T` is the metadata type defined by the caller.
 */
export interface RepeatPattern<T = Record<string, unknown>> {
  date:      string
  time:      string | null
  repeat:    Repeat
  fileSlug:  string
  id:        string                    // own UUID
  // No ownerId — RepeatPatterns are flat siblings, never nested in the store
  metadata:  T
}

// ── Store types ───────────────────────────────────────────────────────────────

/**
 * Raw store items carry OccurrenceMetadata (no file-level fields).
 * File-level identity (title/tags/items/body) lives in the roots map.
 */
export type StoreSeries = RepeatPattern<OccurrenceMetadata>
export type StoreOcc    = OccurrenceEntry<OccurrenceMetadata>
export type StoreItem   = StoreSeries | StoreOcc

/** keyed by fileSlug */
export type Roots = Map<string, FileMetadata>

export function isSeries(item: StoreItem): item is StoreSeries {
  return 'repeat' in item
}

// ── Occurrence display state ──────────────────────────────────────────────────

/** Canonical occurrence state — single domain vocabulary for all styling variants. */
export type OccState =
  | 'event-future'
  | 'event-past'
  | 'task-open'
  | 'task-p1'
  | 'task-p2'
  | 'task-p3'
  | 'note'
  | 'done'

// ── Occurrence ───────────────────────────────────────────────────────────────

/**
 * An expanded occurrence produced by expandRange.
 * Carries AppMetadata (OccurrenceMetadata + FileMetadata joined in).
 */
export type Occurrence = OccurrenceEntry<AppMetadata>
export type EditScope = 'single' | 'future' | 'all' | 'add'
const EDIT_SCOPES: EditScope[] = ['single', 'future', 'all', 'add']
export function isEditScope(s: unknown): s is EditScope {
  return typeof s === 'string' && (EDIT_SCOPES as string[]).includes(s)
}

// ── Inline-field registry ─────────────────────────────────────────────────────
// Single source of truth for all persisted (frontmatter) metadata fields.
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
): FileMetadata {
  // title/tags/items go through the same per-field/per-element coercion as
  // extractOccurrenceMetadata below — this used to hand-roll its own
  // Array.isArray(...) ? raw : [] check, which (unlike parseInlineField)
  // never validated array ELEMENTS, so a malformed `items:` list reached
  // `root.items` — the exact map wikilinks.ts/fileOccurrence.ts iterate —
  // untouched (health survey finding #1).
  const meta = { body: scalarToString(fields.body) } as unknown as FileMetadata
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

// ── Occurrence helpers ────────────────────────────────────────────────────────

/**
 * True when `i` is a standalone OccurrenceEntry — i.e. not a series and not an
 * override child of one. Use this wherever you need to distinguish standalones
 * from series overrides without reaching for an ad-hoc `ownerId` cast.
 */
export function isStandaloneOcc(i: StoreItem): i is StoreOcc {
  return !isSeries(i) && !(i).ownerId
}

/**
 * True when an item/occurrence is a tracked task — i.e. its `done` field is
 * present (not undefined). This is a presence check, not truthiness: a task
 * with `done: false` is still tracked. Do not simplify to `!!done`.
 */
export function isTracked(item: { metadata: { done?: boolean } } | null | undefined): boolean {
  return item?.metadata.done !== undefined
}

// ── Dialog / Editor helpers ───────────────────────────────────────────────────

export interface Scheduled {
  date: string
  time: string
}

// ── Locale preferences ─────────────────────────────────────────────────────────

/** firstDayOfWeek uses Intl getWeekInfo values: 1=Mon, 6=Sat, 7=Sun. */
export type LocalePrefs = {
  hour12: boolean
  firstDayOfWeek: 1 | 6 | 7
}

// ── Vault references ─────────────────────────────────────────────────────────

export type VaultKind = 'local' | 'example' | 'github'

interface VaultRefBase {
  id:   string
  name: string
}

interface LocalVaultRef extends VaultRefBase {
  kind: 'local'
}

interface ExampleVaultRef extends VaultRefBase {
  kind: 'example'
}

export interface GitHubVaultRef extends VaultRefBase {
  kind:   'github'
  github: { owner: string; repo: string; branch: string }
}

export type VaultRef = LocalVaultRef | ExampleVaultRef | GitHubVaultRef
