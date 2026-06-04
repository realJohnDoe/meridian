/**
 * Pure StoreItem[] edit operations.
 *
 * Every function takes a StoreItem[] and returns a new StoreItem[].
 * No store / React / fileIO dependencies — shared by the main app and the debug view.
 */

import type { StoreItem, Occurrence, AppMetadata, Repeat } from '../types'
import { isSeries } from '../types'
import type { OccurrenceEntry, RepeatPattern } from './expansion'
import { titleToSlug } from '../fileIO'

// ── Date helper ───────────────────────────────────────────────────────────────

/** Return the ISO date string for the day before `dateStr`. */
export function dayBefore(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** Items belonging to a specific file. */
export function fileSlugItems(items: StoreItem[], fileSlug: string): StoreItem[] {
  return items.filter(i => i.fileSlug === fileSlug)
}

/** Find the RepeatPattern that owns `occ`. Returns undefined for standalones. */
export function findSeries(
  items: StoreItem[],
  occ: Occurrence,
): RepeatPattern<AppMetadata> | undefined {
  if (!occ.ownerId) return undefined
  return items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<AppMetadata> | undefined
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

/**
 * Upsert an explicit OccurrenceEntry for `occ.date` within `occ.ownerId`'s children.
 * If an override already exists for that date, it's replaced; otherwise appended.
 */
export function upsertOverride(
  items: StoreItem[],
  occ: Occurrence,
  patch: Partial<OccurrenceEntry<AppMetadata>>,
): StoreItem[] {
  if (!occ.ownerId) {
    // Standalone — match by fileSlug + date.
    // Expanded occurrences get a fresh random id each render (expansion.ts line ~684),
    // so occ.id never matches a store item id. Use (fileSlug, date) instead.
    return items.map(i => {
      if (isSeries(i)) return i
      const io = i as OccurrenceEntry<AppMetadata>
      if (io.ownerId) return i   // skip child overrides of a series
      return io.fileSlug === occ.fileSlug && io.date === occ.date
        ? { ...io, ...patch, metadata: { ...io.metadata, ...(patch.metadata ?? {}) } }
        : io
    })
  }
  // Recurring — upsert override child.
  const existing = items.find(
    i => !isSeries(i) && (i as OccurrenceEntry<AppMetadata>).ownerId === occ.ownerId && i.date === occ.date,
  )
  if (existing) {
    return items.map(i =>
      i.id === existing.id
        ? { ...i, ...patch, metadata: { ...i.metadata, ...(patch.metadata ?? {}) } }
        : i,
    )
  }
  // No existing override — create one.
  const series = items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<AppMetadata> | undefined
  const newOverride: OccurrenceEntry<AppMetadata> = {
    date:    occ.date,
    time:    occ.time,
    source:  'explicit',
    fileSlug: occ.fileSlug,
    id:      crypto.randomUUID(),
    ownerId: occ.ownerId,
    metadata: { ...(series?.metadata ?? occ.metadata), ...(patch.metadata ?? {}) },
    ...patch,
  }
  return [...items, newOverride]
}

// ── Edit operations ───────────────────────────────────────────────────────────

export interface EditFields {
  title:        string
  tags:         string[]
  topics:       string[]
  participants: string[]
  body:         string
  tracked:   boolean
  done:      boolean
  priority:  string | null
  scheduled: { date: string; time: string } | null
  duration:  string
  repeat:    Repeat | null
}

/**
 * Build full item metadata from editor fields — used for 'all' scope and new items
 * where the target IS the file root.
 */
function metaFromEditFields(base: Partial<AppMetadata>, f: EditFields): AppMetadata {
  return {
    ...base,
    title:        f.title,
    tags:         f.tags,
    topics:       f.topics ?? [],
    participants: f.participants ?? [],
    body:         f.body || undefined,
    duration:     f.duration || undefined,
    priority:     (f.priority as AppMetadata['priority']) ?? undefined,
    done:         f.tracked ? f.done : undefined,
  }
}

/**
 * Build occurrence-level metadata for an override or new-occurrence child.
 * File-level fields (title, tags, topics, body) always come from `rootMeta`
 * (the series / file root), never from the editor fields, so they cannot
 * diverge per occurrence.
 */
function occurrenceMetaFromFields(rootMeta: Partial<AppMetadata>, f: EditFields): AppMetadata {
  return {
    ...(rootMeta as AppMetadata),
    // File-level fields inherited from root above — do not override them here.
    participants: f.participants ?? [],
    duration:     f.duration || undefined,
    priority:     (f.priority as AppMetadata['priority']) ?? undefined,
    done:         f.tracked ? f.done : undefined,
  }
}

/**
 * Update the file root (series or standalone matching occ's fileSlug) with the
 * file-level fields from `fields` (title, tags, topics, body).
 * Returns the updated items list; does not touch any other fields on the root.
 */
function updateFileRoot(
  items:  StoreItem[],
  occ:    Occurrence,
  fields: EditFields,
): StoreItem[] {
  const fileLevelPatch: Partial<AppMetadata> = {
    title:  fields.title,
    tags:   fields.tags,
    topics: fields.topics ?? [],
    body:   fields.body || undefined,
  }
  const matchRoot = occ.ownerId
    ? (i: StoreItem) => isSeries(i) && i.id === occ.ownerId
    : (i: StoreItem) => !isSeries(i) && !(i as OccurrenceEntry<AppMetadata>).ownerId
        && i.fileSlug === occ.fileSlug && i.date === occ.date
  return items.map(i =>
    matchRoot(i)
      ? { ...i, metadata: { ...i.metadata, ...fileLevelPatch } }
      : i,
  )
}

/**
 * Apply an editor save to the item list.
 *
 * scope 'all'    — update the series (or standalone) metadata.
 * scope 'single' — upsert an explicit override for this occurrence's date.
 * scope 'future' — cap the existing series; create a new sibling series from occDate.
 * scope 'add'    — append a new explicit occurrence.
 * occ == null    — create a brand-new item (series or standalone).
 */
export function applyEdit(
  items: StoreItem[],
  occ: Occurrence | null,
  scope: string,
  fields: EditFields,
): StoreItem[] {
  const { title, scheduled, repeat } = fields

  // ── New item ───────────────────────────────────────────────────────────────
  if (!occ) {
    const fileSlug = titleToSlug(title) || crypto.randomUUID()
    const meta = metaFromEditFields({}, fields)
    if (repeat) {
      const newSeries: RepeatPattern<AppMetadata> = {
        date:     scheduled?.date ?? '',
        time:     scheduled?.time || null,
        repeat,
        fileSlug,
        id:       crypto.randomUUID(),
        metadata: meta,
      }
      return [...items, newSeries]
    } else {
      const newOcc: OccurrenceEntry<AppMetadata> = {
        date:    scheduled?.date ?? '',
        time:    scheduled?.time || null,
        source:  'explicit',
        fileSlug,
        id:      crypto.randomUUID(),
        metadata: meta,
      }
      return [...items, newOcc]
    }
  }

  // ── edit all (series or standalone) ───────────────────────────────────────
  if (scope === 'all') {
    // For a series: match by the stable series UUID (occ.ownerId).
    // For a standalone: occ.id is a random expansion UUID — match by fileSlug instead.
    const matchItem = occ.ownerId
      ? (i: StoreItem) => isSeries(i) && i.id === occ.ownerId
      : (i: StoreItem) => !isSeries(i) && !(i as OccurrenceEntry<AppMetadata>).ownerId && i.fileSlug === occ.fileSlug && i.date === occ.date
    return items.map(i => {
      if (!matchItem(i)) return i
      const meta = metaFromEditFields(i.metadata, fields)
      if (isSeries(i)) {
        return { ...i, metadata: meta, repeat: repeat ?? i.repeat,
          ...(scheduled?.date ? { date: scheduled.date, time: scheduled.time || null } : {}) }
      }
      return { ...i, metadata: meta,
        ...(scheduled?.date ? { date: scheduled.date, time: scheduled.time || null } : {}) }
    })
  }

  // ── single occurrence override ─────────────────────────────────────────────
  if (scope === 'single') {
    // File-level fields always go to the root; the override carries only
    // occurrence-specific fields (done, priority, duration, scheduled, participants).
    const withRoot = updateFileRoot(items, occ, fields)
    const rootMeta = findSeries(withRoot, occ)?.metadata ?? occ.metadata
    const meta = occurrenceMetaFromFields(rootMeta, fields)
    return upsertOverride(withRoot, occ, {
      date:    scheduled?.date ?? occ.date,
      time:    scheduled?.time || null,
      metadata: meta,
    })
  }

  // ── future: split series at occDate ───────────────────────────────────────
  if (scope === 'future') {
    const series = occ.ownerId
      ? (items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<AppMetadata> | undefined)
      : undefined
    if (!series) return applyEdit(items, occ, 'all', fields)

    const occDate = occ.date
    const newSeriesId = crypto.randomUUID()
    const newRepeat = repeat ?? series.repeat
    const newMeta2 = metaFromEditFields(series.metadata, fields)

    return items.flatMap(i => {
      // Cap the original series.
      if (i.id === series.id) {
        const capped = { ...i as RepeatPattern<AppMetadata>,
          repeat: { ...(i as RepeatPattern<AppMetadata>).repeat,
            end: { type: 'until' as const, date: dayBefore(occDate) } } }
        const newSeries: RepeatPattern<AppMetadata> = {
          date:     scheduled?.date ?? occDate,
          time:     scheduled?.time || null,
          repeat:   newRepeat,
          fileSlug: series.fileSlug,
          id:       newSeriesId,
          metadata: newMeta2,
        }
        return [capped, newSeries]
      }
      // Re-point overrides at/after occDate to the new series.
      if (!isSeries(i) && (i as OccurrenceEntry<AppMetadata>).ownerId === series.id && i.date >= occDate) {
        return [{ ...i, ownerId: newSeriesId }]
      }
      return [i]
    })
  }

  // ── add: new explicit occurrence ──────────────────────────────────────────
  if (scope === 'add') {
    const newDate = scheduled?.date ?? occ.date
    const series  = findSeries(items, occ)
    // If there is a series root: update its file-level fields and derive the
    // override metadata from it. For standalone-only files (no series) the new
    // occurrence carries all fields; collapse will hoist shared ones to defaults.
    if (series) {
      const withRoot = updateFileRoot(items, occ, fields)
      const rootMeta = findSeries(withRoot, occ)!.metadata
      const newOcc: OccurrenceEntry<AppMetadata> = {
        date:    newDate,
        time:    scheduled?.time || null,
        source:  'explicit',
        fileSlug: occ.fileSlug,
        id:      crypto.randomUUID(),
        ownerId: occ.ownerId,
        metadata: occurrenceMetaFromFields(rootMeta, fields),
      }
      return [...withRoot, newOcc]
    }
    const newOcc: OccurrenceEntry<AppMetadata> = {
      date:    newDate,
      time:    scheduled?.time || null,
      source:  'explicit',
      fileSlug: occ.fileSlug,
      id:      crypto.randomUUID(),
      ownerId: occ.ownerId,
      metadata: metaFromEditFields(occ.metadata, fields),
    }
    return [...items, newOcc]
  }

  return items
}

// ── Toggle done ───────────────────────────────────────────────────────────────

export function toggleDone(items: StoreItem[], occ: Occurrence): StoreItem[] {
  const newDone = !occ.metadata.done
  return upsertOverride(items, occ, { metadata: { ...occ.metadata, done: newDone } })
}

// ── Exclude / delete ──────────────────────────────────────────────────────────

/** Mark a recurring occurrence as excluded; remove a standalone by id. */
export function excludeOccurrence(items: StoreItem[], occ: Occurrence): StoreItem[] {
  if (occ.ownerId) {
    return upsertOverride(items, occ, { excluded: true })
  }
  return items.filter(i => i.id !== occ.id)
}

/** Remove all items for a fileSlug. */
export function deleteByFileSlug(items: StoreItem[], fileSlug: string): StoreItem[] {
  return items.filter(i => i.fileSlug !== fileSlug)
}

/**
 * Cap a series' repeat.end at the day before occDate.
 * Overrides at/after occDate within that series are also excluded.
 */
export function deleteFollowing(items: StoreItem[], occ: Occurrence): StoreItem[] {
  const series = findSeries(items, occ)
  if (!series) return items
  const occDate = occ.date
  return items.map(i => {
    if (i.id === series.id) {
      return { ...i as RepeatPattern<AppMetadata>,
        repeat: { ...(i as RepeatPattern<AppMetadata>).repeat,
          end: { type: 'until' as const, date: dayBefore(occDate) } } }
    }
    if (!isSeries(i) && (i as OccurrenceEntry<AppMetadata>).ownerId === series.id && i.date >= occDate) {
      return { ...i, excluded: true }
    }
    return i
  })
}
