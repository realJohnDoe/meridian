// ── MERIDIAN DOMAIN TYPES ────────────────────────────────────────────────────

import type { FileConvention, EntryKey } from '@/fileIO'

export type Priority = 'high' | 'medium' | 'low'

export type Weekday = 'mo' | 'tu' | 'we' | 'th' | 'fr' | 'sa' | 'su'

// ── Repeat ───────────────────────────────────────────────────────────────────

/**
 * `until.time` (`HH:mm`, viewer-local) names an instant within `until.date` and
 * is only meaningful alongside it — `date` bounds the series inclusive of the
 * entire day; `date` + `time` bounds it at that instant.
 */
type RepeatEnd =
  | { type: 'until'; date?: string; time?: string }
  | { type: 'count'; occurrences: number }

export type Repeat =
  | { type: 'schedule'; freq: 'daily' | 'weekly' | 'monthly' | 'yearly'; byweekday?: Weekday[]; bymonthday?: number[]; bysetpos?: number | number[]; interval?: number; end?: RepeatEnd }
  | { type: 'after_completion'; interval: string; end?: RepeatEnd }

// ── Metadata types ────────────────────────────────────────────────────────────

/**
 * File-level fields — persisted at the frontmatter root; shared by all
 * occurrences in the file. `body` is markdown, not YAML frontmatter.
 * Stored in the roots map (Map<EntryKey, FileMetadata>), not on StoreItems.
 */
export interface FileMetadata {
  title: string
  tags:  string[]
  items: string[]
  body?: string
  /**
   * Which vault this file came from. Runtime-only, never serialized — in the
   * same family as `fileConvention` below, and likewise absent from
   * `INLINE_FIELDS` (model/fieldRegistry.ts), so `collapseToYaml` never emits
   * it. Present here rather than only inside the map key because
   * `AppMetadata` spreads the root into every expanded occurrence
   * (`joinFileMeta`), which is what gives every `Occurrence` its vault for
   * free — no change to the expansion engine or to any view's data plumbing.
   */
  vaultId:  string
  /**
   * The bare, file-level slug — what `[[wikilinks]]` and the URL carry, and
   * the other half of the map key. Kept beside `vaultId` for the same reason:
   * every occurrence needs it for display and routing, and digging it back
   * out of the key at each call site is how the two slug-shaped strings get
   * confused again.
   */
  fileSlug: string
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
 * The half of `FileMetadata` a parse can derive from the file's own bytes.
 * `vaultId`/`fileSlug`/`fileConvention` are provenance the *caller* supplies
 * (it knows which vault and path it read from), so the parser returns this
 * narrower type and `parseToStoreItems` completes it — making an omission a
 * compile error rather than a silently vault-less root.
 */
export type FileFields = Omit<FileMetadata, 'vaultId' | 'fileSlug' | 'fileConvention'>

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
  entryKey:  EntryKey                  // vault-qualified identity of the source file
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
  entryKey:  EntryKey
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

/** keyed by EntryKey — the same slug in two vaults is two distinct entries */
export type Roots = Map<EntryKey, FileMetadata>

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
