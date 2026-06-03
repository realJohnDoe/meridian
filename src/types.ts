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

// ── AppMetadata extraction ────────────────────────────────────────────────────

/** Extract AppMetadata from the raw fields of an expanded occurrence. */
export function extractAppMetadata(fields: Record<string, unknown>): AppMetadata {
  return {
    title:        fields.title    ? String(fields.title)    : '',
    done:         fields.done     as boolean  | undefined,
    tags:         Array.isArray(fields.tags) ? (fields.tags as string[]) : [],
    participants: Array.isArray(fields.participants) ? (fields.participants as string[]) : undefined,
    priority:     fields.priority as Priority | undefined,
    body:         fields.body     ? String(fields.body)     : undefined,
    duration:     fields.duration ? String(fields.duration) : undefined,
    timezone:     fields.timezone ? String(fields.timezone) : undefined,
    multiday:     fields.multiday as Multiday | undefined,
    jsTime:       fields.jsTime   as Date     | undefined,
  }
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
