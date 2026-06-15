/**
 * Pure StoreData edit operations.
 *
 * Every exported function takes and returns a StoreData snapshot so callers
 * always have a uniform interface. Functions that don't touch file-level data
 * pass roots through unchanged.
 * No store / React / fileIO dependencies — shared by the main app and the debug view.
 */

import type { StoreItem, Occurrence, OccurrenceMetadata, Priority, Repeat, Roots, FileMetadata, EditScope } from '../types'
import { isSeries, isStandaloneOcc } from '../types'
import type { OccurrenceEntry, RepeatPattern } from './expansion'
import { titleToSlug } from '../fileIO'

export interface StoreData {
  items: StoreItem[]
  roots: Roots
}

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
): RepeatPattern<OccurrenceMetadata> | undefined {
  if (!occ.ownerId) return undefined
  return items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined
}

// ── Upsert helper ─────────────────────────────────────────────────────────────

/**
 * Upsert an explicit OccurrenceEntry for `occ.date` within `occ.ownerId`'s children.
 * If an override already exists for that date, it's replaced; otherwise appended.
 */
export function upsertOverride(
  items: StoreItem[],
  occ: Occurrence,
  patch: Partial<OccurrenceEntry<OccurrenceMetadata>>,
): StoreItem[] {
  if (!occ.ownerId) {
    return items.map(i => {
      if (isSeries(i)) return i
      const io = i as OccurrenceEntry<OccurrenceMetadata>
      if (io.ownerId) return i   // skip child overrides of a series
      return io.id === occ.id
        ? { ...io, ...patch, metadata: { ...io.metadata, ...(patch.metadata ?? {}) } }
        : io
    })
  }
  // Recurring — upsert override child.
  const existing = items.find(
    i => !isSeries(i) && (i as OccurrenceEntry<OccurrenceMetadata>).ownerId === occ.ownerId && i.date === occ.date,
  )
  if (existing) {
    return items.map(i =>
      i.id === existing.id
        ? { ...i, ...patch, metadata: { ...i.metadata, ...(patch.metadata ?? {}) } }
        : i,
    )
  }
  // No existing override — create one.
  const series = items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined
  const newOverride: OccurrenceEntry<OccurrenceMetadata> = {
    date:    occ.date,
    time:    occ.time,
    source:  'explicit',
    fileSlug: occ.fileSlug,
    id:      crypto.randomUUID(),
    ownerId: occ.ownerId,
    metadata: { ...(series?.metadata ?? occFromAppMeta(occ.metadata)), ...(patch.metadata ?? {}) },
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
  priority:  Priority | null
  scheduled: { date: string; time: string } | null
  duration:  string
  repeat:    Repeat | null
}

/** Extract OccurrenceMetadata from expanded AppMetadata (strips file-level fields). */
function occFromAppMeta(m: { done?: boolean; participants?: string[]; priority?: Priority; duration?: string; timezone?: string }): OccurrenceMetadata {
  return {
    done:         m.done,
    participants: m.participants ?? [],
    priority:     m.priority,
    duration:     m.duration,
    timezone:     m.timezone,
  }
}

/**
 * Build occurrence-level metadata from editor fields.
 * File-level fields (title/tags/topics/body) never appear here — they go to roots.
 */
function occMeta(base: Partial<OccurrenceMetadata>, f: EditFields): OccurrenceMetadata {
  return {
    ...(base as OccurrenceMetadata),
    participants: f.participants ?? [],
    duration:     f.duration || undefined,
    priority:     f.priority ?? undefined,
    done:         f.tracked ? f.done : undefined,
  }
}

/**
 * Build metadata for a RepeatPattern (series) root. Identical to `occMeta` but
 * `done` is forced to the default (`false` when tracked, `undefined` when not) —
 * never the editor's current `done` value.
 *
 * A series root's `done` is the value every generated occurrence inherits when
 * it has no override of its own (see expansion's `inst.done ?? node.done`).
 * Letting a `true` leak onto the root marks all future occurrences as already
 * done — exactly the `done: true` + `type: after_completion` poisoning we guard
 * against here. Per-occurrence completion is always stored as an override, never
 * on the series root.
 */
function seriesMeta(base: Partial<OccurrenceMetadata>, f: EditFields): OccurrenceMetadata {
  return { ...occMeta(base, f), done: f.tracked ? false : undefined }
}

/**
 * Update (or create) the per-file entry in the roots map with the file-level
 * fields from `fields`. The roots map is the single source of truth for a file's
 * title/tags/topics/body, so every edit scope routes file-level changes here.
 */
export function updateRoot(roots: Roots, fileSlug: string, f: EditFields): Roots {
  const next = new Map(roots)
  const existing = next.get(fileSlug)
  next.set(fileSlug, {
    title:  f.title,
    tags:   f.tags,
    topics: f.topics ?? [],
    body:   f.body || undefined,
    ...(existing ? {} : {}),  // merge if needed — for now full replace from form
  })
  return next
}

/**
 * Apply an editor save to the store data.
 *
 * scope 'all'    — update the series (or standalone) metadata.
 * scope 'single' — upsert an explicit override for this occurrence's date.
 * scope 'future' — cap the existing series; create a new sibling series from occDate.
 * scope 'add'    — append a new explicit occurrence.
 * occ == null    — create a brand-new item (series or standalone).
 */
export function applyEdit(
  data: StoreData,
  occ: Occurrence | null,
  scope: EditScope,
  fields: EditFields,
): StoreData {
  const { title, scheduled, repeat } = fields
  let { items, roots } = data

  // ── New item ───────────────────────────────────────────────────────────────
  if (!occ) {
    const fileSlug = titleToSlug(title) || crypto.randomUUID()
    const newRoot: FileMetadata = {
      title, tags: fields.tags, topics: fields.topics ?? [], body: fields.body || undefined,
    }
    const newRoots = new Map(roots)
    newRoots.set(fileSlug, newRoot)
    if (repeat) {
      const newSeries: RepeatPattern<OccurrenceMetadata> = {
        date:     scheduled?.date ?? '',
        time:     scheduled?.time || null,
        repeat,
        fileSlug,
        id:       crypto.randomUUID(),
        metadata: seriesMeta({}, fields),
      }
      return { items: [...items, newSeries], roots: newRoots }
    } else {
      const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
        date:    scheduled?.date ?? '',
        time:    scheduled?.time || null,
        source:  'explicit',
        fileSlug,
        id:      crypto.randomUUID(),
        metadata: occMeta({}, fields),
      }
      return { items: [...items, newOcc], roots: newRoots }
    }
  }

  // ── edit all (series or standalone) ───────────────────────────────────────
  if (scope === 'all') {
    // File-level fields go to roots; occurrence fields to the item.
    roots = updateRoot(roots, occ.fileSlug, fields)
    const matchItem = occ.ownerId
      ? (i: StoreItem) => isSeries(i) && i.id === occ.ownerId
      : (i: StoreItem) => isStandaloneOcc(i) && i.id === occ.id
    items = items.map(i => {
      if (!matchItem(i)) return i
      if (isSeries(i)) {
        return { ...i, metadata: seriesMeta(i.metadata, fields), repeat: repeat ?? i.repeat,
          date: scheduled?.date ?? '', time: scheduled?.date ? scheduled.time || null : null }
      }
      return { ...i, metadata: occMeta(i.metadata, fields),
        date: scheduled?.date ?? '', time: scheduled?.date ? scheduled.time || null : null }
    })
    return { items, roots }
  }

  // ── single occurrence override ─────────────────────────────────────────────
  if (scope === 'single') {
    // File-level fields go to the roots; the override carries only
    // occurrence-specific fields (done, priority, duration, scheduled, participants).
    roots = updateRoot(roots, occ.fileSlug, fields)
    const baseSeries = findSeries(items, occ)
    const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
    const newDate = scheduled?.date ?? ''
    const newTime = scheduled?.date ? scheduled.time || null : null

    // Moving a *generated* occurrence to another date can't be expressed by a
    // single override: the override key (its date) doubles as the recurrence-id,
    // so changing the date leaves the original generated slot un-suppressed.
    // Instead, exclude the original slot and attach a detached occurrence at the
    // new date. (Explicit/detached occurrences sit on non-generated dates, so
    // moving them in place needs no exclusion.)
    if (occ.ownerId && occ.source === 'generated' && newDate && newDate !== occ.date) {
      items = upsertOverride(items, occ, { excluded: true })
      const moved: OccurrenceEntry<OccurrenceMetadata> = {
        date:     newDate,
        time:     newTime,
        source:   'explicit',
        fileSlug: occ.fileSlug,
        id:       crypto.randomUUID(),
        ownerId:  occ.ownerId,
        metadata: occMeta(base, fields),
      }
      return { items: [...items, moved], roots }
    }

    items = upsertOverride(items, occ, {
      date:    newDate,
      time:    newTime,
      metadata: occMeta(base, fields),
    })
    return { items, roots }
  }

  // ── future: split series at occDate ───────────────────────────────────────
  if (scope === 'future') {
    const series = occ.ownerId
      ? (items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined)
      : undefined
    if (!series) return applyEdit(data, occ, 'all', fields)

    const occDate = occ.date
    const newSeriesId = crypto.randomUUID()
    const newRepeat = repeat ?? series.repeat
    const newMeta2 = seriesMeta(series.metadata, fields)
    roots = updateRoot(roots, occ.fileSlug, fields)

    items = items.flatMap(i => {
      // Cap the original series.
      if (i.id === series.id) {
        const capped = { ...i as RepeatPattern<OccurrenceMetadata>,
          repeat: { ...(i as RepeatPattern<OccurrenceMetadata>).repeat,
            end: { type: 'until' as const, date: dayBefore(occDate) } } }
        const newSeries: RepeatPattern<OccurrenceMetadata> = {
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
      if (!isSeries(i) && (i as OccurrenceEntry<OccurrenceMetadata>).ownerId === series.id && i.date >= occDate) {
        return [{ ...i, ownerId: newSeriesId }]
      }
      return [i]
    })
    return { items, roots }
  }

  // ── add: new explicit occurrence ──────────────────────────────────────────
  if (scope === 'add') {
    const newDate = scheduled?.date ?? occ.date
    const baseSeries = findSeries(items, occ)
    const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
    roots = updateRoot(roots, occ.fileSlug, fields)
    const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
      date:    newDate,
      time:    scheduled?.time || null,
      source:  'explicit',
      fileSlug: occ.fileSlug,
      id:      crypto.randomUUID(),
      ownerId: occ.ownerId,
      metadata: occMeta(base, fields),
    }
    return { items: [...items, newOcc], roots }
  }

  return data
}

// ── Toggle done ───────────────────────────────────────────────────────────────

export function toggleDone({ items, roots }: StoreData, occ: Occurrence): StoreData {
  const newDone = !occ.metadata.done
  return { items: upsertOverride(items, occ, { metadata: { ...occFromAppMeta(occ.metadata), done: newDone } }), roots }
}

// ── Exclude / delete ──────────────────────────────────────────────────────────

/** Mark a recurring occurrence as excluded; remove a standalone by id. */
export function excludeOccurrence({ items, roots }: StoreData, occ: Occurrence): StoreData {
  if (occ.ownerId) {
    return { items: upsertOverride(items, occ, { excluded: true }), roots }
  }
  return { items: items.filter(i => i.id !== occ.id), roots }
}

/** Remove all items and the root entry for a fileSlug. */
export function deleteByFileSlug({ items, roots }: StoreData, fileSlug: string): StoreData {
  const nextRoots = new Map(roots)
  nextRoots.delete(fileSlug)
  return { items: items.filter(i => i.fileSlug !== fileSlug), roots: nextRoots }
}

/**
 * Cap a series' repeat.end at the day before occDate.
 * Overrides at/after occDate within that series are also excluded.
 */
export function deleteFollowing({ items, roots }: StoreData, occ: Occurrence): StoreData {
  const series = findSeries(items, occ)
  if (!series) return { items, roots }
  const occDate = occ.date
  return {
    roots,
    items: items.map(i => {
      if (i.id === series.id) {
        return { ...i as RepeatPattern<OccurrenceMetadata>,
          repeat: { ...(i as RepeatPattern<OccurrenceMetadata>).repeat,
            end: { type: 'until' as const, date: dayBefore(occDate) } } }
      }
      if (!isSeries(i) && (i as OccurrenceEntry<OccurrenceMetadata>).ownerId === series.id && i.date >= occDate) {
        return { ...i, excluded: true }
      }
      return i
    }),
  }
}
