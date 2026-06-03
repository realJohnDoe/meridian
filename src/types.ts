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

export interface Multiday {
  start: string
  end: string
}

// ── Metadata types ────────────────────────────────────────────────────────────

/** Fields written to YAML frontmatter; not relevant for inheritance/repeat expansion. */
export interface InlineMetadata {
  title:     string
  done?:         boolean
  tags:          string[]
  participants?: string[]
  priority?:     Priority
  duration?:     string
  timezone?: string
}

/** Fields never persisted to YAML — computed at runtime or used only by the UI. */
export interface ExtendedMetadata {
  jsTime?:   Date      // computed from date+time; undefined in raw store items
  body?:     string    // markdown body (not frontmatter)
  multiday?: Multiday
  _dh?:      number    // DayView layout
  _endMs?:   number    // DayView layout
}

export type AppMetadata = InlineMetadata & ExtendedMetadata

// ── Store types ───────────────────────────────────────────────────────────────

import type { OccurrenceEntry, RepeatPattern } from './model/expansion'

/**
 * Store holds RepeatPattern (series) or OccurrenceEntry (single item or explicit override).
 * Uses AppMetadata so body and multiday survive the load → edit round-trip.
 * collapseToYaml only writes InlineMetadata fields regardless.
 */
export type StoreItem = RepeatPattern<AppMetadata> | OccurrenceEntry<AppMetadata>

export function isSeries(item: StoreItem): item is RepeatPattern<AppMetadata> {
  return 'repeat' in item && item.repeat !== undefined
}

// ── Occurrence ───────────────────────────────────────────────────────────────

/**
 * An expanded occurrence produced by expandRange.
 * Alias for OccurrenceEntry<AppMetadata>.
 */
export type Occurrence      = OccurrenceEntry<AppMetadata>
export type CollectedSeries = RepeatPattern<AppMetadata>  // same as RepeatPattern<AppMetadata> in StoreItem
export type EditScope = 'single' | 'future' | 'all' | 'add'

// ── Inline-field registry ─────────────────────────────────────────────────────
// Single source of truth for the persisted (frontmatter) metadata fields.
// Drives extraction, YAML serialization, default-hoisting, and diffing so that
// adding a field is a one-line change here instead of editing several parallel
// key lists that silently drift out of sync.

export type InlineFieldKind = 'string' | 'boolean' | 'priority' | 'stringArray'

interface InlineFieldSpec {
  key:       keyof InlineMetadata
  kind:      InlineFieldKind
  /** Required fields get a non-undefined default ('' or []) when absent from raw. */
  required?: boolean
}

export const INLINE_FIELDS: readonly InlineFieldSpec[] = [
  { key: 'title',        kind: 'string',      required: true },
  { key: 'done',         kind: 'boolean' },
  { key: 'tags',         kind: 'stringArray', required: true },
  { key: 'participants', kind: 'stringArray' },
  { key: 'priority',     kind: 'priority' },
  { key: 'duration',     kind: 'string' },
  { key: 'timezone',     kind: 'string' },
]

/** Coerce a raw YAML value to the typed value for `spec`. */
function parseInlineField(spec: InlineFieldSpec, raw: unknown): unknown {
  switch (spec.kind) {
    case 'boolean':     return raw as boolean | undefined
    case 'priority':    return raw as Priority | undefined
    case 'stringArray': return Array.isArray(raw) ? (raw as string[]) : (spec.required ? [] : undefined)
    case 'string':      return raw ? String(raw) : (spec.required ? '' : undefined)
  }
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

// ── AppMetadata extraction ────────────────────────────────────────────────────

/** Extract AppMetadata from the raw fields of an expanded occurrence. */
export function extractAppMetadata(fields: Record<string, unknown>): AppMetadata {
  const meta = {} as AppMetadata
  const sink = meta as unknown as Record<string, unknown>
  for (const spec of INLINE_FIELDS) {
    sink[spec.key] = parseInlineField(spec, fields[spec.key])
  }
  // Extended (non-persisted) fields — runtime/UI only.
  meta.body     = fields.body     ? String(fields.body) : undefined
  meta.multiday = fields.multiday as Multiday | undefined
  meta.jsTime   = fields.jsTime   as Date     | undefined
  return meta
}

// ── Occurrence helpers ────────────────────────────────────────────────────────

/** Derive the display kind from occurrence data. */
export function occKind(occ: Occurrence): 'event' | 'task' | 'note' {
  return occ.metadata.done !== undefined ? 'task' : occ.date ? 'event' : 'note'
}

/** True when the occurrence belongs to a recurring series (has an ownerId). */
export function occIsRecur(occ: Occurrence, items?: StoreItem[]): boolean {
  if (occ.ownerId) return true
  if (items) return items.some(i => isSeries(i) && i.id === occ.ownerId)
  return false
}

// ── Dialog / Editor helpers ───────────────────────────────────────────────────

export interface Scheduled {
  date: string
  time: string
}
