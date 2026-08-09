// ── MERIDIAN DOMAIN TYPES ────────────────────────────────────────────────────

import type { FileConvention } from '@/fileIO'

export type Priority = 'high' | 'medium' | 'low'

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
