// ── MERIDIAN DOMAIN TYPES ────────────────────────────────────────────────────

export type Priority = 'high' | 'medium' | 'low'

export type Weekday = 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa' | 'su'

// ── Repeat ───────────────────────────────────────────────────────────────────

export type RepeatEnd =
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
}

/** Fields never persisted to YAML — computed at runtime or used only by the UI. */
export interface ExtendedMetadata {
  jsTime?: Date    // computed from date+time; undefined in raw store items
}

/**
 * Full metadata on an EXPANDED occurrence (file-level joined back from roots).
 * Raw store items carry OccurrenceMetadata only; AppMetadata only appears after
 * expandRange has joined the file-level fields.
 */
export type AppMetadata = OccurrenceMetadata & FileMetadata & ExtendedMetadata

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
  return 'repeat' in item && item.repeat !== undefined
}

// ── Occurrence ───────────────────────────────────────────────────────────────

/**
 * An expanded occurrence produced by expandRange.
 * Carries AppMetadata (OccurrenceMetadata + FileMetadata joined in).
 */
export type Occurrence      = OccurrenceEntry<AppMetadata>
export type CollectedSeries = RepeatPattern<AppMetadata>
export type EditScope = 'single' | 'future' | 'all' | 'add'

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

export const INLINE_FIELDS: readonly InlineFieldSpec[] = [
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

/** Coerce a raw YAML value to the typed value for `spec`. */
function parseInlineField(spec: InlineFieldSpec, raw: unknown): unknown {
  switch (spec.kind) {
    case 'boolean':     return raw as boolean | undefined
    case 'priority':    return raw as Priority | undefined
    case 'stringArray': return Array.isArray(raw) ? (raw as string[]) : (spec.required ? [] : undefined)
    case 'string':      return raw ? String(raw) : (spec.required ? '' : undefined)
  }
}

/** Extract file-level metadata from raw YAML fields. Migrates legacy `topics` to `items`. */
export function extractFileMetadata(fields: Record<string, unknown>): FileMetadata {
  return {
    title: (fields.title ? String(fields.title) : '') as string,
    tags:  Array.isArray(fields.tags) ? (fields.tags as string[]) : [],
    items: Array.isArray(fields.items) ? (fields.items as string[]) : [],
    body:  fields.body ? String(fields.body) : undefined,
  }
}

/** Extract occurrence-level metadata from the raw fields of a node or occurrence. */
export function extractOccurrenceMetadata(fields: Record<string, unknown>): OccurrenceMetadata {
  const meta = {} as OccurrenceMetadata
  const sink = meta as unknown as Record<string, unknown>
  for (const spec of OCCURRENCE_FIELDS) {
    sink[spec.key] = parseInlineField(spec, fields[spec.key])
  }
  return meta
}

// ── Occurrence helpers ────────────────────────────────────────────────────────

/**
 * True when `i` is a standalone OccurrenceEntry — i.e. not a series and not an
 * override child of one. Use this wherever you need to distinguish standalones
 * from series overrides without reaching for an ad-hoc `ownerId` cast.
 */
export function isStandaloneOcc(i: StoreItem): i is StoreOcc {
  return !isSeries(i) && !(i as StoreOcc).ownerId
}

/** Derive the display kind from occurrence data. */
export function occKind(occ: Occurrence): 'event' | 'task' | 'note' {
  return occ.metadata.done !== undefined ? 'task' : occ.date ? 'event' : 'note'
}

/** True when the occurrence belongs to a recurring series (has an ownerId). */
export function occIsRecur(occ: Occurrence): boolean {
  return !!occ.ownerId
}

// ── Dialog / Editor helpers ───────────────────────────────────────────────────

export interface Scheduled {
  date: string
  time: string
}
