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
  const { title, tags, participants, body, tracked, done, priority, scheduled, duration, repeat } = fields

  const newMeta = (): AppMetadata => ({
    title,
    tags,
    participants: participants?.length ? participants : undefined,
    body:         body || undefined,
    duration:     duration || undefined,
    priority:     (priority as AppMetadata['priority']) ?? undefined,
    done:         tracked ? done : undefined,
    timezone:     undefined,
  })

  // ── New item ───────────────────────────────────────────────────────────────
  if (!occ) {
    const fileSlug = titleToSlug(title) || crypto.randomUUID()
    const meta = newMeta()
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
      const meta: AppMetadata = {
        ...i.metadata,
        title,
        tags,
        participants: participants?.length ? participants : undefined,
        body:         body || undefined,
        duration:     duration || undefined,
        priority:     (priority as AppMetadata['priority']) ?? undefined,
        done:         tracked ? done : undefined,
      }
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
    const meta: AppMetadata = {
      ...(findSeries(items, occ)?.metadata ?? occ.metadata),
      title,
      tags,
      participants: participants?.length ? participants : undefined,
      body:     body || undefined,
      duration: duration || undefined,
      priority: (priority as AppMetadata['priority']) ?? undefined,
      done:     tracked ? done : undefined,
      ...(scheduled?.time ? {} : {}),
    }
    return upsertOverride(items, occ, {
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
    const newMeta2: AppMetadata = {
      ...series.metadata,
      title,
      tags,
      participants: participants?.length ? participants : undefined,
      body:     body || undefined,
      duration: duration || undefined,
      priority: (priority as AppMetadata['priority']) ?? undefined,
      done:     tracked ? done : undefined,
    }

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
    const newOcc: OccurrenceEntry<AppMetadata> = {
      date:    newDate,
      time:    scheduled?.time || null,
      source:  'explicit',
      fileSlug: occ.fileSlug,
      id:      crypto.randomUUID(),
      ownerId: occ.ownerId,
      metadata: {
        ...(series?.metadata ?? occ.metadata),
        title,
        tags,
        participants: participants?.length ? participants : undefined,
        body:     body || undefined,
        duration: duration || undefined,
        priority: (priority as AppMetadata['priority']) ?? undefined,
        done:     tracked ? done : undefined,
      },
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
