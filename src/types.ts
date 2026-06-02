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

// ── Node ─────────────────────────────────────────────────────────────────────

/** Per-occurrence override stored inside a Node's `instances` array. */
export interface Instance {
  date: string
  time?: string
  done?: boolean
  excluded?: boolean
  title?: string
  body?: string
  tags?: string[]
  duration?: string
  priority?: Priority
  /** Used for 'future' scope child node that starts a new series. */
  repeat?: Repeat
}

export interface Multiday {
  start: string
  end: string
}

/** Canonical data structure — maps 1:1 to a YAML file on disk. */
export interface Node {
  id: string
  title: string
  body?: string
  date?: string
  time?: string
  duration?: string
  done?: boolean
  tags?: string[]
  priority?: Priority
  repeat?: Repeat
  instances?: Instance[]
  multiday?: Multiday
  timezone?: string
  /** Runtime-cached resolved file path — not persisted to YAML. */
  _path?: string
}

// ── AppMetadata ───────────────────────────────────────────────────────────────

/**
 * Content and tracking metadata for a main-app occurrence.
 * Lives inside OccurrenceEntry<AppMetadata>.metadata.
 */
export interface AppMetadata {
  title:     string
  done?:     boolean
  tags:      string[]
  priority?: Priority
  body?:     string
  duration?: string
  repeat?:   Repeat
  multiday?: Multiday
  timezone?: string
  /** Source node ID — use for store lookups during edits. */
  nodeId:    string
  /** Layout fields set post-expansion by DayView. */
  _dh?:      number
  _endMs?:   number
}

/** Extract AppMetadata from the raw fields of an expanded occurrence. */
export function extractAppMetadata(fields: Record<string, unknown>): AppMetadata {
  return {
    title:    fields.title    ? String(fields.title)    : '',
    done:     fields.done     as boolean  | undefined,
    tags:     Array.isArray(fields.tags) ? (fields.tags as string[]) : [],
    priority: fields.priority as Priority | undefined,
    body:     fields.body     ? String(fields.body)     : undefined,
    duration: fields.duration ? String(fields.duration) : undefined,
    repeat:   fields.repeat   as Repeat   | undefined,
    multiday: fields.multiday as Multiday | undefined,
    timezone: fields.timezone ? String(fields.timezone) : undefined,
    nodeId:   String(fields._nodeId ?? fields.id ?? ''),
  }
}

// ── Occurrence helpers ────────────────────────────────────────────────────────

/** Derive the display kind from occurrence data. */
export function occKind(occ: Occurrence): 'event' | 'task' | 'note' {
  return occ.metadata.done !== undefined ? 'task' : occ.date ? 'event' : 'note'
}

/** True when the occurrence belongs to a recurring series. */
export function occIsRecur(occ: Occurrence): boolean {
  return !!occ.metadata.repeat
}

// ── Occurrence ───────────────────────────────────────────────────────────────

import type { OccurrenceEntry } from './model/expansion'

/**
 * An expanded occurrence produced by expandRange.
 * Alias for OccurrenceEntry<AppMetadata>.
 */
export type Occurrence = OccurrenceEntry<AppMetadata>

// ── Dialog / Editor helpers ───────────────────────────────────────────────────

export interface Scheduled {
  date: string
  time: string
}
