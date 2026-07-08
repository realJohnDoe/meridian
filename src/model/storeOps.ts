/**
 * Pure StoreData edit operations.
 *
 * Every exported function takes and returns a StoreData snapshot so callers
 * always have a uniform interface. Functions that don't touch file-level data
 * pass roots through unchanged.
 * No store / React / fileIO dependencies — shared by the main app and the debug view.
 */

import type { StoreItem, Occurrence, OccurrenceMetadata, Priority, Repeat, Roots, FileMetadata, EditScope, OccurrenceEntry, RepeatPattern } from '@/types'
import { isSeries, isStandaloneOcc } from '@/types'
import { titleToSlug } from '@/fileIO'
import { dayBefore } from './dateUtils'
import { resolveWikilink, unwrapRef } from '../wikilinks'

export interface StoreData {
  items: StoreItem[]
  roots: Roots
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
  // Recurring — upsert override child. Match the specific child by id: an
  // expanded occurrence carries its backing child's store id, so this targets
  // the exact instance the user acted on even when several overrides share a
  // date. A generated occurrence has no backing child (its id is a memoised
  // synthetic key), so it finds nothing here and falls through to create one.
  const existing = items.find(
    i => !isSeries(i) && (i as OccurrenceEntry<OccurrenceMetadata>).ownerId === occ.ownerId && i.id === occ.id,
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

/**
 * Drop any exclusion-only stub already sitting at `date` for `ownerId`.
 *
 * An occurrence about to occupy that date supersedes an earlier "hide this
 * slot" marker. Without this, moving an occurrence onto a date that already
 * carries an excluded stub (e.g. moving it back to where it started, or onto
 * a date excluded for an unrelated reason) leaves two children on the same
 * date; `expandNode`'s override lookup returns the first array match, which
 * can be the stale excluded stub, silently hiding the real occurrence.
 */
function dropExclusionStub(items: StoreItem[], ownerId: string, date: string): StoreItem[] {
  return items.filter(i => {
    if (isSeries(i)) return true
    const io = i as OccurrenceEntry<OccurrenceMetadata>
    return !(io.ownerId === ownerId && io.date === date && io.excluded)
  })
}

// ── Edit operations ───────────────────────────────────────────────────────────

export interface EditorFields {
  title:        string
  tags:         string[]
  items:        string[]
  participants: string[]
  tracked:      boolean
  done:         boolean
  priority:     Priority | null
  scheduled:    { date: string; time: string } | null
  duration:     string
  repeat:       Repeat | null
}

export interface EditFields extends EditorFields {
  body: string
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
 * File-level fields (title/tags/items/body) never appear here — they go to roots.
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
 * title/tags/items/body, so every edit scope routes file-level changes here.
 */
export function updateRoot(roots: Roots, fileSlug: string, f: EditFields): Roots {
  const next = new Map(roots)
  next.set(fileSlug, {
    title: f.title,
    tags:  f.tags,
    items: f.items ?? [],
    body:  f.body || undefined,
  })
  return next
}

/** Create a brand-new item (series or standalone). */
function applyNew({ items, roots }: StoreData, fields: EditFields): StoreData {
  const { title, scheduled, repeat } = fields
  const fileSlug = titleToSlug(title) || crypto.randomUUID()
  const newRoot: FileMetadata = {
    title, tags: fields.tags, items: fields.items ?? [], body: fields.body || undefined,
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
  }
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

/** Update the series (or standalone) metadata across all occurrences. */
function applyAll({ items, roots }: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  const { scheduled, repeat } = fields
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

/**
 * Upsert an explicit override for a single occurrence's date.
 *
 * A standalone gaining a repeat is converted to a series in place.
 * A generated occurrence moved to a different date gets excluded and a detached
 * explicit child is appended (the override key doubles as recurrence-id, so an
 * in-place date change would leave the original generated slot un-suppressed).
 * Either way, landing on a date that already carries an exclusion stub (e.g.
 * moving the occurrence back to where it started) clears that stub first —
 * see `dropExclusionStub`.
 */
function applySingle({ items, roots }: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  const { scheduled, repeat } = fields
  roots = updateRoot(roots, occ.fileSlug, fields)
  const baseSeries = findSeries(items, occ)
  const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
  const newDate = scheduled?.date ?? ''
  const newTime = scheduled?.date ? scheduled.time || null : null

  if (repeat && !occ.ownerId) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     newDate,
      time:     newTime,
      repeat,
      fileSlug: occ.fileSlug,
      id:       occ.id,
      metadata: seriesMeta(base, fields),
    }
    return { items: items.map(i => i.id === occ.id ? newSeries : i), roots }
  }

  if (occ.ownerId && occ.source === 'generated' && newDate && newDate !== occ.date) {
    items = upsertOverride(items, occ, { excluded: true })
    items = dropExclusionStub(items, occ.ownerId, newDate)
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

  if (occ.ownerId && newDate && newDate !== occ.date) {
    items = dropExclusionStub(items, occ.ownerId, newDate)
  }

  return {
    items: upsertOverride(items, occ, { date: newDate, time: newTime, metadata: occMeta(base, fields) }),
    roots,
  }
}

/**
 * Cap the existing series at the day before occDate and start a new sibling
 * series from occDate onward. Falls back to `applyAll` when occ is not part of
 * a series (standalone occurrence edited with scope 'future').
 */
function applyFuture(data: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  let { items, roots } = data
  const { scheduled, repeat } = fields
  const series = occ.ownerId
    ? (items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined)
    : undefined
  if (!series) return applyAll(data, occ, fields)

  const occDate = occ.date
  const newSeriesId = crypto.randomUUID()
  const newRepeat = repeat ?? series.repeat
  const newMeta = seriesMeta(series.metadata, fields)
  roots = updateRoot(roots, occ.fileSlug, fields)

  items = items.flatMap(i => {
    if (i.id === series.id) {
      const capped: RepeatPattern<OccurrenceMetadata> = {
        ...(i as RepeatPattern<OccurrenceMetadata>),
        repeat: { ...(i as RepeatPattern<OccurrenceMetadata>).repeat,
          end: { type: 'until' as const, date: dayBefore(occDate) } },
      }
      const newSeries: RepeatPattern<OccurrenceMetadata> = {
        date:     scheduled?.date ?? occDate,
        time:     scheduled?.time || null,
        repeat:   newRepeat,
        fileSlug: series.fileSlug,
        id:       newSeriesId,
        metadata: newMeta,
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

/**
 * Append a new explicit occurrence linked to the same file (and series, if any).
 *
 * When the editor supplies a `repeat`, the addition is a brand-new recurring
 * rule for the file (e.g. a "second Friday" series alongside an existing "first
 * Friday" one). It's stored as a flat sibling RepeatPattern — never as a child
 * of `occ`'s series — so collapse emits it as its own `instances[]` entry with
 * its own `repeat:` block.
 */
function applyAdd({ items, roots }: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  const { scheduled, repeat } = fields
  const newDate = scheduled?.date ?? ''
  const baseSeries = findSeries(items, occ)
  const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
  roots = updateRoot(roots, occ.fileSlug, fields)
  if (repeat) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     newDate,
      time:     scheduled?.time || null,
      repeat,
      fileSlug: occ.fileSlug,
      id:       crypto.randomUUID(),
      metadata: seriesMeta(base, fields),
    }
    return { items: [...items, newSeries], roots }
  }
  const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
    date:    newDate,
    time:    scheduled?.time || null,
    source:  'explicit',
    fileSlug: occ.fileSlug,
    id:      crypto.randomUUID(),
    ownerId: occ.ownerId,
    metadata: { ...occMeta(base, fields), done: fields.tracked ? false : undefined },
  }
  return { items: [...items, newOcc], roots }
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
  if (!occ) return applyNew(data, fields)
  switch (scope) {
    case 'all':    return applyAll(data, occ, fields)
    case 'single': return applySingle(data, occ, fields)
    case 'future': return applyFuture(data, occ, fields)
    case 'add':    return applyAdd(data, occ, fields)
    default:       return data
  }
}

// ── Toggle done ───────────────────────────────────────────────────────────────

export function toggleDone({ items, roots }: StoreData, occ: Occurrence): StoreData {
  const newDone = !occ.metadata.done
  return { items: upsertOverride(items, occ, { metadata: { ...occFromAppMeta(occ.metadata), done: newDone } }), roots }
}

// ── Exclude / delete ──────────────────────────────────────────────────────────

/**
 * True when deleting `occ` would end its after_completion series: `occ` is
 * the series' one open (undone, non-excluded) occurrence, and once it's gone
 * there is nothing left that could trigger the next occurrence's generation.
 */
export function deletionEndsAfterCompletionSeries(items: StoreItem[], occ: Occurrence): boolean {
  const series = findSeries(items, occ)
  if (!series || series.repeat?.type !== 'after_completion') return false
  if (occ.metadata.done) return false
  return !items.some(i => {
    if (isSeries(i)) return false
    const io = i as OccurrenceEntry<OccurrenceMetadata>
    return io.ownerId === series.id && io.id !== occ.id && !io.excluded && !io.metadata.done
  })
}

/** Mark a recurring occurrence as excluded; remove a standalone by id. */
export function excludeOccurrence({ items, roots }: StoreData, occ: Occurrence): StoreData {
  if (occ.ownerId) {
    return { items: upsertOverride(items, occ, { excluded: true }), roots }
  }
  return { items: items.filter(i => i.id !== occ.id), roots }
}

/** Remove all items and the root entry for a fileSlug, cleaning up backlinks from other files. */
export function deleteByFileSlug({ items, roots }: StoreData, fileSlug: string): StoreData {
  const nextRoots = new Map(roots)
  for (const [slug, meta] of nextRoots) {
    if (slug === fileSlug) continue
    const filtered = (meta.items ?? []).filter(
      raw => resolveWikilink(unwrapRef(raw), roots) !== fileSlug,
    )
    if (filtered.length !== (meta.items ?? []).length)
      nextRoots.set(slug, { ...meta, items: filtered })
  }
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
