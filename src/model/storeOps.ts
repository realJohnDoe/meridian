/**
 * Pure StoreData edit operations.
 *
 * Every exported function takes and returns a StoreData snapshot so callers
 * always have a uniform interface. Functions that don't touch file-level data
 * pass roots through unchanged.
 * No store / React / fileIO dependencies — shared by the main app and the debug view.
 */

import type { StoreItem, Occurrence, OccurrenceMetadata, Priority, Repeat, Roots, EditScope, OccurrenceEntry, RepeatPattern } from '@/types'
import { isSeries, isStandaloneOcc } from '@/types'
import { titleToSlug } from '@/fileIO'
import { dayBefore } from './dateUtils'
import { stableOccId } from './expansion'
import { resolveWikilink, unwrapRef } from '../wikilinks'

export interface StoreData {
  items: StoreItem[]
  roots: Roots
  /**
   * Slugs occupied by a file that exists on disk but failed to parse, so it
   * has neither a root nor an item of its own — see `slugTaken`/`newEntrySlug`.
   * Optional: most StoreData snapshots (any edit to an existing item) have no
   * use for it and omit it.
   */
  unreadableSlugs?: ReadonlySet<string>
}

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** Items belonging to a specific file. */
export function fileSlugItems(items: StoreItem[], fileSlug: string): StoreItem[] {
  return items.filter(i => i.entryKey === fileSlug)
}

/** Find the RepeatPattern that owns `occ`. Returns undefined for standalones. */
export function findSeries(
  items: StoreItem[],
  occ: Occurrence,
): RepeatPattern<OccurrenceMetadata> | undefined {
  if (!occ.ownerId) return undefined
  return items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined
}

/**
 * How an occurrence sits inside a recurring series — the facts that decide which
 * edit scopes it offers and whether a repeat pattern can be attached at all.
 *
 * `isScheduled` and `isAfterCompletion` describe the PARENT SERIES' repeat, not
 * the occurrence's own: an override child carries no `repeat` of its own, so the
 * distinction only exists one level up. Both are false for a standalone.
 */
export interface SeriesContext {
  /** The occurrence belongs to a repeating series (it is an override child). */
  isRecurring: boolean
  /** Its series repeats on a calendar schedule — "this and following" is meaningful. */
  isScheduled: boolean
  /** Its series repeats a fixed interval after each completion. */
  isAfterCompletion: boolean
  /** The parent series' repeat spec, or null for a standalone. */
  seriesRepeat: Repeat | null
}

export function seriesContext(items: StoreItem[], occ: Occurrence | null): SeriesContext {
  const series = occ ? findSeries(items, occ) : undefined
  const seriesRepeat = series?.repeat ?? null
  return {
    isRecurring: !!occ?.ownerId,
    isScheduled: seriesRepeat?.type === 'schedule',
    isAfterCompletion: seriesRepeat?.type === 'after_completion',
    seriesRepeat,
  }
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
      const io = i
      if (io.ownerId) return i   // skip child overrides of a series
      return io.id === occ.id
        ? { ...io, ...patch, metadata: mergeOccMeta(io.metadata, patch.metadata) }
        : io
    })
  }
  // Recurring — upsert override child. Match the specific child by id: an
  // expanded occurrence carries its backing child's store id, so this targets
  // the exact instance the user acted on even when several overrides share a
  // date. A generated occurrence has no backing child (its id is the
  // deterministic stableOccId key), so it finds nothing here and falls
  // through to create one.
  const existing = items.find(
    i => !isSeries(i) && i.ownerId === occ.ownerId && i.id === occ.id,
  )
  if (existing) {
    return items.map(i =>
      i.id === existing.id
        ? { ...i, ...patch, metadata: mergeOccMeta(i.metadata, patch.metadata) }
        : i,
    )
  }
  // No existing override — create one. Reuse occ.id (a generated occurrence's
  // id is already the deterministic stableOccId key) instead of minting a
  // fresh random one, so the occurrence's React row key stays stable across
  // the very commit that creates its first override — otherwise the row
  // would unmount/remount on every first toggle of a recurring occurrence.
  // Guard against an (unexpected) id collision with an existing item so two
  // overrides can never end up sharing an id.
  const series = items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined
  const newId = items.some(i => i.id === occ.id) ? crypto.randomUUID() : occ.id
  const newOverride: OccurrenceEntry<OccurrenceMetadata> = {
    date:    occ.date,
    time:    occ.time,
    source:  'explicit',
    entryKey: occ.entryKey,
    id:      newId,
    ownerId: occ.ownerId,
    // The new override inherits the series' metadata as its base; collapse then
    // diffs the inherited half back out, so only genuine divergences persist.
    metadata: mergeOccMeta(series?.metadata ?? occFromAppMeta(occ.metadata), patch.metadata),
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
    const io = i
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

// ── Metadata constructors ─────────────────────────────────────────────────────
//
// THE four places a metadata value is built: `occFromAppMeta` (convert),
// `mergeOccMeta` (combine two), `occMeta`/`seriesMeta` (from editor fields), and
// `updateRoot` (file level). Nothing else in this module may assemble an
// OccurrenceMetadata or FileMetadata field-by-field — a literal that forgets
// `extra` silently deletes the user's unknown frontmatter keys on the next save,
// and nothing type-checks that omission because `extra` is optional. Spreading
// the result of one of these (`{ ...occMeta(base, f), done: x }`) is fine; the
// bag rides along.
//
// **Invariant that makes one merge rule sufficient: an edit never mints unknown
// keys.** They originate only at parse time and flow through, so every bag
// reaching this module is derived from some parsed base — which is why
// `mergeOccMeta` can always prefer the base's bag without ever discarding a
// value the editor meant to write.

/** Strip specific keys out of an extra bag, e.g. before writing a field the bag might shadow. */
function withoutKeys(extra: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!extra) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(extra)) {
    if (!keys.includes(k)) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Combine two occurrence-metadata values — the single place this happens.
 *
 * Typed fields: `patch` wins, since it carries the newer, editor-supplied value.
 * Unknown keys: `base` wins. Per the invariant above a patch's bag is always
 * inherited from somewhere, so preferring the base is what stops a series'
 * `owner: alice` from overwriting an override's own `owner: bob` when a
 * scope-`single` edit rebuilds that override from its series.
 */
function mergeOccMeta(
  base: OccurrenceMetadata,
  patch: Partial<OccurrenceMetadata> | undefined,
): OccurrenceMetadata {
  const extra = base.extra || patch?.extra ? { ...patch?.extra, ...base.extra } : undefined
  return { ...base, ...patch, extra }
}

/** Extract OccurrenceMetadata from expanded AppMetadata (strips file-level fields). */
export function occFromAppMeta(m: { done?: boolean; participants?: string[]; priority?: Priority; duration?: string; timezone?: string; extra?: Record<string, unknown> }): OccurrenceMetadata {
  return {
    done:         m.done,
    participants: m.participants ?? [],
    priority:     m.priority,
    duration:     m.duration,
    timezone:     m.timezone,
    ...(m.extra ? { extra: m.extra } : {}),
  }
}

/**
 * Build occurrence-level metadata from editor fields.
 * File-level fields (title/tags/items/body) never appear here — they go to roots.
 *
 * Strips the registry keys this function writes out of `base.extra`: a
 * malformed known field (e.g. `duration: [1, 2]`) is preserved in `extra` under
 * its own key, and that stale raw value must not shadow a value the editor just
 * wrote for the same field.
 */
function occMeta(base: Partial<OccurrenceMetadata>, f: EditFields): OccurrenceMetadata {
  return {
    ...(base as OccurrenceMetadata),
    participants: f.participants,
    duration:     f.duration || undefined,
    priority:     f.priority ?? undefined,
    done:         f.tracked ? f.done : undefined,
    extra:        withoutKeys(base.extra, ['participants', 'duration', 'priority', 'done']),
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
 *
 * Carries the previous entry's `extra` forward — without this, every save
 * through every scope would silently wipe unknown frontmatter keys at the file
 * root, since this function otherwise rebuilds FileMetadata from scratch.
 *
 * Carries `fileConvention` forward too, for the same reason: it is never part
 * of `EditFields` (the user cannot edit it), so a rebuild that omitted it would
 * silently revert the file to Meridian's LF default the moment it's next
 * saved — the exact class of loss finding #8 was about, reintroduced one
 * layer up if this line is ever dropped.
 */
function updateRoot(roots: Roots, fileSlug: string, f: EditFields): Roots {
  const next = new Map(roots)
  const prev = roots.get(fileSlug)
  next.set(fileSlug, {
    title: f.title,
    tags:  f.tags,
    items: f.items,
    body:  f.body || undefined,
    extra: withoutKeys(prev?.extra, ['title', 'tags', 'items']),
    fileConvention: prev?.fileConvention,
  })
  return next
}

/** Apply editor fields onto an existing series or standalone item's structural + metadata fields. */
function applyFieldsToItem(item: StoreItem, fields: EditFields): StoreItem {
  const { scheduled, repeat } = fields
  if (isSeries(item)) {
    return { ...item, metadata: seriesMeta(item.metadata, fields), repeat: repeat ?? item.repeat,
      date: scheduled?.date ?? '', time: scheduled?.date ? scheduled.time || null : null }
  }
  return { ...item, metadata: occMeta(item.metadata, fields),
    date: scheduled?.date ?? '', time: scheduled?.date ? scheduled.time || null : null }
}

/**
 * Push the editor's metadata onto a series' override children — "all events"
 * means all events, including occurrences the user has already overridden.
 *
 * Without this the override silently keeps the old value. Its stored metadata
 * was materialised from the series at parse time (see `effectiveNodeToStoreItems`,
 * which merges the node's inherited fields into every child), so once the series
 * moves on, collapse re-reads that inherited copy as a genuine divergence and
 * emits the stale value back onto the instance — leaving one occurrence behind
 * on a change the user asked to apply everywhere. Matches how calendar apps
 * treat the same choice.
 *
 * Deliberately narrower than `applyFieldsToItem`. A child keeps:
 *  - `date`/`time` — the whole reason the override exists is to sit elsewhere;
 *  - `done` — an "all events" metadata change must not un-complete finished
 *    occurrences (and `seriesMeta` forces `done` to the series default, which
 *    would do exactly that);
 *  - `excluded` — a deleted occurrence stays deleted;
 *  - its unknown-key bag — an edit never mints unknown keys (see the invariant
 *    above `mergeOccMeta`), so there is nothing to propagate, and a child's own
 *    `owner: bob` must survive an edit that never mentioned `owner`.
 *
 * Spreading `occMeta`'s result rather than assembling a literal is the
 * sanctioned form — see the "Metadata constructors" note above.
 */
function applyFieldsToChildren(items: StoreItem[], seriesId: string, fields: EditFields): StoreItem[] {
  return items.map(i => {
    if (isSeries(i) || i.ownerId !== seriesId) return i
    return { ...i, metadata: { ...occMeta(i.metadata, fields), done: i.metadata.done } }
  })
}

// ── New-entry slug allocation ─────────────────────────────────────────────────

/** True when some file already occupies `fileSlug` in this snapshot. */
function slugTaken({ items, roots, unreadableSlugs }: StoreData, fileSlug: string): boolean {
  return roots.has(fileSlug) || items.some(i => i.entryKey === fileSlug) || (unreadableSlugs?.has(fileSlug) ?? false)
}

/**
 * The item a still-unadopted draft already created, if its first save has run.
 *
 * `draftId` is the id `applyNew` stamps on the item it creates, so this is the
 * one identity that distinguishes "this draft saving again" (upsert) from "a
 * different entry whose title happens to slugify onto a taken slug" (allocate a
 * free slug). Restricted to series/standalone roots — a draft is never an
 * override child.
 */
function findDraft(items: StoreItem[], draftId: string | undefined): StoreItem | undefined {
  if (!draftId) return undefined
  return items.find(i => i.id === draftId && (isSeries(i) || isStandaloneOcc(i)))
}

/**
 * The file slug a brand-new entry will occupy.
 *
 * A draft that already created its file keeps that file, whatever its title has
 * since become — the rename happens inside the file, not by moving it.
 *
 * Otherwise the title's slug is used, unless another entry already owns it, in
 * which case a `-2`, `-3`, … suffix is appended until a free one is found.
 * `titleToSlug` collides freely ("Buy groceries" / "Buy groceries!" / any two
 * titles agreeing in their first 60 slug characters all map to `buy-groceries`)
 * and a file write is a whole-file replace, so without this a new entry would
 * silently destroy the unrelated entry sitting on its slug. `slugTaken` also
 * consults `data.unreadableSlugs`, so a file that failed to parse (and so has
 * neither a root nor an item) still holds its slug instead of looking free.
 *
 * Exported because callers need the resulting slug to know which file to
 * persist — see `saveNode`.
 */
export function newEntrySlug(data: StoreData, title: string, draftId?: string): string {
  const draft = findDraft(data.items, draftId)
  if (draft) return draft.entryKey

  const base = titleToSlug(title) || crypto.randomUUID()
  if (!slugTaken(data, base)) return base
  let n = 2
  while (slugTaken(data, `${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Create a brand-new item (series or standalone).
 *
 * A "new entry" commit can run more than once for the same not-yet-adopted item
 * (e.g. a debounced autosave firing after an in-dialog save already created the
 * file), so the later runs must upsert onto what the first created rather than
 * append a sibling — two items sharing one fileSlug collapse into a duplicate
 * `instances[]` entry on write. `draftId` is what makes those runs recognisable:
 * it is stamped on the item created here, so a re-run finds it by id. Callers
 * that create genuinely one-shot entries (e.g. promoting a checklist line) can
 * omit it; they then always get a free slug.
 */
function applyNew(data: StoreData, fields: EditFields, draftId?: string): StoreData {
  const { items, roots } = data
  const { scheduled, repeat } = fields
  const fileSlug = newEntrySlug(data, fields.title, draftId)

  const draft = findDraft(items, draftId)
  if (draft) {
    return {
      items: items.map(i => i.id === draft.id ? applyFieldsToItem(i, fields) : i),
      roots: updateRoot(roots, fileSlug, fields),
    }
  }

  // Routed through updateRoot rather than a second FileMetadata literal: with no
  // previous entry it produces exactly the same shape, and there is then only
  // one place in the module where file-level metadata is assembled.
  const newRoots = updateRoot(roots, fileSlug, fields)
  if (repeat) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     scheduled?.date ?? '',
      time:     scheduled?.time || null,
      repeat,
      entryKey: fileSlug,
      id:       draftId ?? crypto.randomUUID(),
      metadata: seriesMeta({}, fields),
    }
    return { items: [...items, newSeries], roots: newRoots }
  }
  const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
    date:    scheduled?.date ?? '',
    time:    scheduled?.time || null,
    source:  'explicit',
    entryKey: fileSlug,
    id:      draftId ?? crypto.randomUUID(),
    metadata: occMeta({}, fields),
  }
  return { items: [...items, newOcc], roots: newRoots }
}

/** Update the series (or standalone) metadata across all occurrences. */
function applyAll({ items, roots }: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  roots = updateRoot(roots, occ.entryKey, fields)
  const matchItem = occ.ownerId
    ? (i: StoreItem) => isSeries(i) && i.id === occ.ownerId
    : (i: StoreItem) => isStandaloneOcc(i) && i.id === occ.id
  items = items.map(i => matchItem(i) ? applyFieldsToItem(i, fields) : i)
  // …and onto the series' override children, so "all events" reaches the
  // occurrences the user already overrode — see `applyFieldsToChildren`.
  if (occ.ownerId) items = applyFieldsToChildren(items, occ.ownerId, fields)
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
  roots = updateRoot(roots, occ.entryKey, fields)
  const baseSeries = findSeries(items, occ)
  const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
  const newDate = scheduled?.date ?? ''
  const newTime = scheduled?.date ? scheduled.time || null : null

  if (repeat && !occ.ownerId) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     newDate,
      time:     newTime,
      repeat,
      entryKey: occ.entryKey,
      id:       occ.id,
      metadata: seriesMeta(base, fields),
    }
    return { items: items.map(i => i.id === occ.id ? newSeries : i), roots }
  }

  if (occ.ownerId && occ.source === 'generated' && newDate && newDate !== occ.date) {
    items = upsertOverride(items, occ, { excluded: true })
    items = dropExclusionStub(items, occ.ownerId, newDate)
    // Keyed by target slot rather than a fresh UUID so re-running the same move is
    // idempotent. The editor pins `entry.item` to the pre-move occurrence for the
    // whole session (useEntryEditor's useState initialiser), so every later save —
    // a debounced body autosave, the flush on close — replays this branch with the
    // same `occ`; a random id would append a second occurrence on the target date
    // each time.
    const movedId = stableOccId(`${occ.ownerId}|${newDate}|${newTime ?? ''}`)
    const moved: OccurrenceEntry<OccurrenceMetadata> = {
      date:     newDate,
      time:     newTime,
      source:   'explicit',
      entryKey: occ.entryKey,
      id:       movedId,
      ownerId:  occ.ownerId,
      metadata: occMeta(base, fields),
    }
    const already = items.some(i => i.id === movedId)
    return {
      items: already ? items.map(i => i.id === movedId ? moved : i) : [...items, moved],
      roots,
    }
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
  roots = updateRoot(roots, occ.entryKey, fields)

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
        entryKey: series.entryKey,
        id:       newSeriesId,
        metadata: newMeta,
      }
      return [capped, newSeries]
    }
    // Re-point overrides at/after occDate to the new series, applying the same
    // metadata the new series root got. Without this they keep the value they
    // inherited from the OLD series and collapse re-emits it as a divergence —
    // the same defect `applyFieldsToChildren` fixes for scope 'all', and the
    // same reasoning: "this and following" covers the overridden occurrences in
    // that range too. `done`/`excluded`/date/time stay the child's own.
    if (!isSeries(i) && i.ownerId === series.id && i.date >= occDate) {
      return [{ ...i, ownerId: newSeriesId, metadata: { ...occMeta(i.metadata, fields), done: i.metadata.done } }]
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
  roots = updateRoot(roots, occ.entryKey, fields)
  if (repeat) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     newDate,
      time:     scheduled?.time || null,
      repeat,
      entryKey: occ.entryKey,
      id:       crypto.randomUUID(),
      metadata: seriesMeta(base, fields),
    }
    return { items: [...items, newSeries], roots }
  }
  const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
    date:    newDate,
    time:    scheduled?.time || null,
    source:  'explicit',
    entryKey: occ.entryKey,
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
 * occ == null    — create a brand-new item (series or standalone). `draftId`
 *                  identifies the editor draft doing the creating, so a repeat
 *                  commit for the same draft upserts instead of creating a
 *                  second file — see `applyNew`.
 */
export function applyEdit(
  data: StoreData,
  occ: Occurrence | null,
  scope: EditScope,
  fields: EditFields,
  draftId?: string,
): StoreData {
  if (!occ) return applyNew(data, fields, draftId)
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
  if (!series || series.repeat.type !== 'after_completion') return false
  if (occ.metadata.done) return false
  return !items.some(i => {
    if (isSeries(i)) return false
    const io = i
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

/**
 * Remove all items and the root entry for a fileSlug, cleaning up backlinks
 * from other files.
 *
 * Returns `affectedSlugs` — the OTHER files whose `items:` list this edited —
 * alongside `data`, rather than making every caller separately consult the
 * store's backlink index to find the same set. Before this, two callers
 * (`editor/save.ts`) did that lookup by hand and one (the swipe-delete path in
 * `occurrenceActions.ts`) did not — which is finding #7: a swipe-deleted
 * entry's backlink cleanup was applied to the in-memory store but never
 * persisted, and Undo never restored it. Reporting the set here — computed
 * from the exact same filter that performs the edit, not a second index that
 * could in principle disagree — makes the correct call the only one available
 * rather than the one every caller has to remember to make. (The now-unused
 * imperative accessor for that index, `getBacklinks()`, has been removed from
 * `storeBridge.ts`; the reactive `useStore(s => s.backlinks)` the UI panels
 * use is untouched.)
 */
export function deleteByFileSlug(
  { items, roots }: StoreData,
  fileSlug: string,
): { data: StoreData; affectedSlugs: string[] } {
  const nextRoots = new Map(roots)
  const affectedSlugs: string[] = []
  for (const [slug, meta] of nextRoots) {
    if (slug === fileSlug) continue
    const filtered = meta.items.filter(
      raw => resolveWikilink(unwrapRef(raw), roots) !== fileSlug,
    )
    if (filtered.length !== meta.items.length) {
      nextRoots.set(slug, { ...meta, items: filtered })
      affectedSlugs.push(slug)
    }
  }
  nextRoots.delete(fileSlug)
  return {
    data: { items: items.filter(i => i.entryKey !== fileSlug), roots: nextRoots },
    affectedSlugs,
  }
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
      if (!isSeries(i) && i.ownerId === series.id && i.date >= occDate) {
        return { ...i, excluded: true }
      }
      return i
    }),
  }
}
