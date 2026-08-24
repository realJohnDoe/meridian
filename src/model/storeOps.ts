/**
 * Pure StoreData edit operations.
 *
 * Every exported function takes and returns a StoreData snapshot so callers
 * always have a uniform interface. Functions that don't touch file-level data
 * pass roots through unchanged.
 * No store / React / fileIO dependencies — shared by the main app and the debug view.
 */

import type { StoreItem, Occurrence, OccurrenceMetadata, Priority, Repeat, Roots, EditScope, OccurrenceEntry, RepeatPattern, Entry, Entries } from '@/types'
import { isSeries, isStandaloneOcc } from '@/types'
import { titleToSlug, entryKey as makeEntryKey, parseEntryKey } from '@/fileIO'
import type { EntryKey } from '@/fileIO'
import { dayBefore } from './dateUtils'
import { stableOccId } from './expansion'
import { resolveWikilink, parseWikilinks, unwrapRef } from '../wikilinks'

export interface StoreData {
  /**
   * Every entry, each one whole. An `apply*` below updates a single `Entry`
   * object rather than two collections that have to be kept in step by hand.
   */
  entries: Entries
  /**
   * Entries occupied by a file that exists on disk but failed to parse, so it
   * has neither a root nor an item of its own — see `slugTaken`/`newEntryKey`.
   * Optional: most StoreData snapshots (any edit to an existing item) have no
   * use for it and omit it.
   */
  unreadableKeys?: ReadonlySet<EntryKey>
}

// ── Entry helpers ─────────────────────────────────────────────────────────────

/**
 * A `Roots` view of `entries`, for `resolveWikilink` — which resolves a bare
 * ref against every entry's file-level fields and so wants them flat.
 */
function rootsView(entries: Entries): Roots {
  const roots: Roots = new Map()
  for (const [key, entry] of entries) roots.set(key, entry.root)
  return roots
}

/**
 * Replace one entry. Every other entry keeps its object identity, which is what
 * the caches downstream memoize on — see `deriveViews` in store.ts.
 */
function withEntry(entries: Entries, entry: Entry): Entries {
  const next = new Map(entries)
  next.set(entry.key, entry)
  return next
}

// ── Lookup helpers ────────────────────────────────────────────────────────────

/** Items belonging to a specific file. */
export function entryKeyItems(items: StoreItem[], entryKey: EntryKey): StoreItem[] {
  return items.filter(i => i.entryKey === entryKey)
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
 * The entry as it stands after an edit: file-level fields from `fields`, and
 * the occurrences the caller says it now has.
 *
 * Replaces the old `updateRoot`, which took and returned the roots map alone.
 * That signature is the two-line slip this whole aggregate exists to prevent:
 * "update the root, then match no item" type-checked, and produced an entry
 * with file-level fields and no occurrences — invisible in search, never
 * written to disk. Here the occurrences are a required argument, so the root
 * cannot be updated without saying what the entry now contains.
 *
 * Carries the previous entry's `extra` forward — without this, every save
 * through every scope would silently wipe unknown frontmatter keys at the file
 * root, since this otherwise rebuilds FileMetadata from scratch.
 *
 * Carries `fileConvention` forward too, for the same reason: it is never part
 * of `EditFields` (the user cannot edit it), so a rebuild that omitted it would
 * silently revert the file to Meridian's LF default the moment it's next
 * saved — the exact class of loss finding #8 was about, reintroduced one
 * layer up if this line is ever dropped.
 */
function editedEntry(
  prev: Entry | undefined,
  key: EntryKey,
  fields: EditFields,
  items: StoreItem[],
): Entry {
  const prevRoot = prev?.root
  return {
    key,
    items,
    root: {
      title: fields.title,
      tags:  fields.tags,
      items: fields.items,
      body:  fields.body || undefined,
      extra: withoutKeys(prevRoot?.extra, ['title', 'tags', 'items']),
      // Derived from the key rather than copied from `prev`, which is the same
      // carry-forward as `fileConvention` below but strictly safer: it is also
      // correct when there IS no previous entry (a brand-new file), and it makes
      // the root's provenance and the map key incapable of disagreeing. Dropping
      // these would leave every edited entry vault-less — wikilink resolution and
      // routing would then silently fall back to the wrong vault.
      ...parseEntryKey(key),
      fileConvention: prevRoot?.fileConvention,
    },
  }
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

/**
 * Where a brand-new entry goes. `vaultId` is the target vault (the default
 * vault, or whatever the editor's vault chip was set to); `draftId` identifies
 * the editor draft, so a second create-scoped save upserts onto the file the
 * first one made instead of creating another.
 */
export interface NewEntryTarget {
  vaultId:  string
  draftId?: string
}

/** True when some file already occupies `key` in this snapshot. */
function slugTaken({ entries, unreadableKeys }: StoreData, key: EntryKey): boolean {
  return entries.has(key) || (unreadableKeys?.has(key) ?? false)
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
function findDraft(entries: Entries, draftId: string | undefined): Entry | undefined {
  if (!draftId) return undefined
  for (const entry of entries.values()) {
    if (entry.items.some(i => i.id === draftId && (isSeries(i) || isStandaloneOcc(i)))) return entry
  }
  return undefined
}

/**
 * The key a brand-new entry will occupy in `vaultId`.
 *
 * A draft that already created its file keeps that file — and its vault —
 * whatever its title has since become; the rename happens inside the file, not
 * by moving it.
 *
 * Otherwise the title's slug is used, unless another entry **in that same
 * vault** already owns it, in which case a `-2`, `-3`, … suffix is appended
 * until a free one is found. Collision is per vault by construction: the key
 * carries the vault, so the same title in two vaults lands on the same slug in
 * each rather than uniquifying against a file it will never share a directory
 * with. `titleToSlug` collides freely ("Buy groceries" / "Buy groceries!" / any
 * two titles agreeing in their first 60 slug characters all map to
 * `buy-groceries`) and a file write is a whole-file replace, so without this a
 * new entry would silently destroy the unrelated entry sitting on its slug.
 * `slugTaken` also consults `data.unreadableKeys`, so a file that failed to
 * parse (and so has neither a root nor an item) still holds its slug instead of
 * looking free.
 *
 * Exported because callers need the resulting key to know which file to
 * persist — see `saveNode`.
 */
export function newEntryKey(data: StoreData, vaultId: string, title: string, draftId?: string): EntryKey {
  const draft = findDraft(data.entries, draftId)
  if (draft) return draft.key

  return freeEntryKey(data, vaultId, titleToSlug(title) || crypto.randomUUID())
}

/**
 * `baseSlug` in `vaultId` if nothing owns it there, else `baseSlug-2`, `-3`, …
 *
 * The allocation half of `newEntryKey`, split out because a cross-vault move
 * needs exactly the same rule against a *different* starting slug: a move keeps
 * the entry's own slug rather than re-deriving one from its title, but must
 * still not land on top of a file the target vault already has. Sharing the
 * search means "how a free slug is found" has one definition — including its
 * consultation of `unreadableKeys` through `slugTaken`, which is what stops
 * either caller from silently overwriting a file that exists but failed to
 * parse.
 */
export function freeEntryKey(data: StoreData, vaultId: string, baseSlug: string): EntryKey {
  if (!slugTaken(data, makeEntryKey(vaultId, baseSlug))) return makeEntryKey(vaultId, baseSlug)
  let n = 2
  while (slugTaken(data, makeEntryKey(vaultId, `${baseSlug}-${n}`))) n++
  return makeEntryKey(vaultId, `${baseSlug}-${n}`)
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
function applyNew(data: StoreData, fields: EditFields, vaultId: string, draftId?: string): StoreData {
  const { entries } = data
  const entryKey = newEntryKey(data, vaultId, fields.title, draftId)
  const prev = entries.get(entryKey)

  const draft = findDraft(entries, draftId)
  if (draft) {
    const items = draft.items.map(i => i.id === draftId ? applyFieldsToItem(i, fields) : i)
    return { ...data, entries: withEntry(entries, editedEntry(draft, draft.key, fields, items)) }
  }

  // Routed through `editedEntry` rather than a second FileMetadata literal: with
  // no previous entry it produces exactly the same shape, and there is then only
  // one place in the module where file-level metadata is assembled. The entry is
  // born with its item, not with a root that a later statement has to remember
  // to match.
  const items = [...(prev?.items ?? []), freshItem(entryKey, fields, draftId ?? crypto.randomUUID())]
  return { ...data, entries: withEntry(entries, editedEntry(prev, entryKey, fields, items)) }
}

/**
 * The one item a brand-new entry starts life as — a series when the editor's
 * fields carry a repeat, a standalone otherwise.
 *
 * Shared by `applyNew` and by `applyEdit`'s revival branch, which needs exactly
 * the same construction against a key that already exists rather than a freshly
 * allocated one.
 */
function freshItem(entryKey: EntryKey, fields: EditFields, id: string): StoreItem {
  const { scheduled, repeat } = fields
  if (repeat) {
    const series: RepeatPattern<OccurrenceMetadata> = {
      date:     scheduled?.date ?? '',
      time:     scheduled?.time || null,
      repeat,
      entryKey,
      id,
      metadata: seriesMeta({}, fields),
    }
    return series
  }
  const occ: OccurrenceEntry<OccurrenceMetadata> = {
    date:    scheduled?.date ?? '',
    time:    scheduled?.time || null,
    source:  'explicit',
    entryKey,
    id,
    metadata: occMeta({}, fields),
  }
  return occ
}

/** Update the series (or standalone) metadata across all occurrences. */
function applyAll(data: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const matchItem = occ.ownerId
    ? (i: StoreItem) => isSeries(i) && i.id === occ.ownerId
    : (i: StoreItem) => isStandaloneOcc(i) && i.id === occ.id
  let items = entry.items.map(i => matchItem(i) ? applyFieldsToItem(i, fields) : i)
  // …and onto the series' override children, so "all events" reaches the
  // occurrences the user already overrode — see `applyFieldsToChildren`.
  if (occ.ownerId) items = applyFieldsToChildren(items, occ.ownerId, fields)
  return { ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, items)) }
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
function applySingle(data: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  const { scheduled, repeat } = fields
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const commit = (items: StoreItem[]): StoreData =>
    ({ ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, items)) })
  let items = entry.items
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
    return commit(items.map(i => i.id === occ.id ? newSeries : i))
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
    return commit(already ? items.map(i => i.id === movedId ? moved : i) : [...items, moved])
  }

  if (occ.ownerId && newDate && newDate !== occ.date) {
    items = dropExclusionStub(items, occ.ownerId, newDate)
  }

  return commit(upsertOverride(items, occ, { date: newDate, time: newTime, metadata: occMeta(base, fields) }))
}

/**
 * Cap the existing series at the day before occDate and start a new sibling
 * series from occDate onward. Falls back to `applyAll` when occ is not part of
 * a series (standalone occurrence edited with scope 'future').
 */
function applyFuture(data: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  const { scheduled, repeat } = fields
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const series = occ.ownerId
    ? (entry.items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined)
    : undefined
  if (!series) return applyAll(data, occ, fields)

  const occDate = occ.date
  const newSeriesId = crypto.randomUUID()
  const newRepeat = repeat ?? series.repeat
  const newMeta = seriesMeta(series.metadata, fields)

  const items = entry.items.flatMap(i => {
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
  return { ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, items)) }
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
function applyAdd(data: StoreData, occ: Occurrence, fields: EditFields): StoreData {
  const { scheduled, repeat } = fields
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const items = entry.items
  const commit = (next: StoreItem[]): StoreData =>
    ({ ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, next)) })
  const newDate = scheduled?.date ?? ''
  const baseSeries = findSeries(items, occ)
  const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
  if (repeat) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     newDate,
      time:     scheduled?.time || null,
      repeat,
      entryKey: occ.entryKey,
      id:       crypto.randomUUID(),
      metadata: seriesMeta(base, fields),
    }
    return commit([...items, newSeries])
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
  return commit([...items, newOcc])
}

/**
 * Apply an editor save to the store data.
 *
 * scope 'all'    — update the series (or standalone) metadata.
 * scope 'single' — upsert an explicit override for this occurrence's date.
 * scope 'future' — cap the existing series; create a new sibling series from occDate.
 * scope 'add'    — append a new explicit occurrence.
 * occ == null    — create a brand-new item (series or standalone) in
 *                  `target.vaultId`. `target.draftId` identifies the editor
 *                  draft doing the creating, so a repeat commit for the same
 *                  draft upserts instead of creating a second file — see
 *                  `applyNew`.
 *
 * `target` is consulted only on the `occ == null` leg: an existing occurrence
 * already carries its vault inside its own key, and an edit never moves a file
 * between vaults (that is `moveEntity`'s job, not this one's).
 */
export function applyEdit(
  data: StoreData,
  occ: Occurrence | null,
  scope: EditScope,
  fields: EditFields,
  target: NewEntryTarget,
): StoreData {
  if (!occ) return applyNew(data, fields, target.vaultId, target.draftId)
  // The occurrence the editor is holding has no item behind it any more — its
  // file was deleted remotely, in another tab, or by a reconcile, while the
  // editor stayed open on it. Rebuild the item on the entry's own key instead,
  // so the edit lands on a whole entry rather than half of one.
  const existing = data.entries.get(occ.entryKey)
  if (!existing || existing.items.length === 0) {
    const items = [...(existing?.items ?? []), freshItem(occ.entryKey, fields, occ.ownerId ?? occ.id)]
    return { ...data, entries: withEntry(data.entries, editedEntry(existing, occ.entryKey, fields, items)) }
  }
  switch (scope) {
    case 'all':    return applyAll(data, occ, fields)
    case 'single': return applySingle(data, occ, fields)
    case 'future': return applyFuture(data, occ, fields)
    case 'add':    return applyAdd(data, occ, fields)
    default:       return data
  }
}

// ── Toggle done ───────────────────────────────────────────────────────────────

export function toggleDone(data: StoreData, occ: Occurrence): StoreData {
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const newDone = !occ.metadata.done
  const items = upsertOverride(entry.items, occ, { metadata: { ...occFromAppMeta(occ.metadata), done: newDone } })
  // The root is untouched — this changes an occurrence, not a file-level
  // field — so it is carried over by reference, and the caches that memoize on
  // `roots` identity are entitled to notice that nothing there moved.
  return { ...data, entries: withEntry(data.entries, { ...entry, items }) }
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
export function excludeOccurrence(data: StoreData, occ: Occurrence): StoreData {
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const items = occ.ownerId
    ? upsertOverride(entry.items, occ, { excluded: true })
    : entry.items.filter(i => i.id !== occ.id)
  // Root untouched, same as `toggleDone`.
  return { ...data, entries: withEntry(data.entries, { ...entry, items }) }
}

/**
 * Remove all items and the root entry for one entry, cleaning up backlinks
 * from other files.
 *
 * Link cleanup is vault-scoped for free: each candidate root's items are
 * resolved inside that root's OWN vault, so a `[[meeting-notes]]` in another
 * vault can never resolve to this key and is left alone.
 *
 * Returns `affectedKeys` — the OTHER files whose `items:` list this edited —
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
export function deleteByEntryKey(
  data: StoreData,
  entryKey: EntryKey,
): { data: StoreData; affectedKeys: EntryKey[] } {
  const roots = rootsView(data.entries)
  const next = new Map(data.entries)
  const affectedKeys: EntryKey[] = []
  for (const [key, entry] of next) {
    if (key === entryKey) continue
    const meta = entry.root
    const filtered = meta.items.filter(
      raw => resolveWikilink(unwrapRef(raw), roots, meta.vaultId) !== entryKey,
    )
    if (filtered.length !== meta.items.length) {
      next.set(key, { ...entry, root: { ...meta, items: filtered } })
      affectedKeys.push(key)
    }
  }
  // Deleting the key deletes the entry whole — both halves at once, because
  // there is only one thing to delete. Absence from `entries` is what the write
  // path reads as "delete this file".
  next.delete(entryKey)
  return { data: { ...data, entries: next }, affectedKeys }
}

// ── Cross-vault move ──────────────────────────────────────────────────────────

/**
 * Re-key one entry — every item plus its root — from `fromKey` to `toKey`.
 *
 * The whole of a move, as far as the domain is concerned: an entry's vault
 * lives in its key, so moving it between vaults is re-keying it and nothing
 * else. The root's `vaultId`/`fileSlug` are re-derived from `toKey` (never
 * copied from the old root) for the same reason `updateRoot` does it — the
 * root's provenance and the map key must be incapable of disagreeing. Every
 * other field, including `extra` and `fileConvention`, is carried over
 * verbatim: a move is not an edit of the file's contents.
 *
 * **No other file is touched, by design.** Wikilinks are per vault and stored
 * bare, so the links pointing at this entry from its old vault — and the links
 * inside it that pointed at that vault — now resolve to nothing. Rewriting them
 * is not possible (there is nothing correct to rewrite them to), so they break
 * visibly instead; `moveLinkBreakage` is what lets the caller say how much
 * before the user commits.
 */
export function moveEntryKey(data: StoreData, fromKey: EntryKey, toKey: EntryKey): StoreData {
  const entry = data.entries.get(fromKey)
  if (!entry) return data
  const next = new Map(data.entries)
  next.delete(fromKey)
  next.set(toKey, {
    key:   toKey,
    root:  { ...entry.root, ...parseEntryKey(toKey) },
    items: entry.items.map(i => ({ ...i, entryKey: toKey })),
  })
  return { ...data, entries: next }
}

/** What a move to another vault will break. Counted, not repaired — see `moveEntryKey`. */
export interface LinkBreakage {
  /** Entries in the source vault whose `items:` list points at this one. */
  inbound:  EntryKey[]
  /** Refs inside this entry that resolve in the source vault but not in the target. */
  outbound: string[]
}

/**
 * Count both directions of link breakage a move of `fromKey` into `toVaultId`
 * would cause, so the confirm dialog can state it plainly.
 *
 * Inbound is every *other* file that links here — resolved inside its own
 * vault, which is exactly `deleteByEntryKey`'s filter, since leaving a vault
 * looks identical to a deletion from the perspective of the files left behind.
 *
 * Outbound covers the moved file's own links: both its `items:` list and the
 * `[[wikilinks]]` in its body. A ref counts only if it resolves in the source
 * vault *and* does not resolve in the target — a link to a slug the target
 * vault happens to have too keeps working, and saying otherwise would overstate
 * the damage. Self-links are excluded: after the move the entry's own slug
 * resolves to it in its new vault, so nothing breaks.
 */
export function moveLinkBreakage(
  data: StoreData, fromKey: EntryKey, toVaultId: string,
): LinkBreakage {
  const roots = rootsView(data.entries)
  const fromVaultId = parseEntryKey(fromKey).vaultId
  const inbound: EntryKey[] = []
  for (const [key, meta] of roots) {
    if (key === fromKey) continue
    if (meta.items.some(raw => resolveWikilink(unwrapRef(raw), roots, meta.vaultId) === fromKey)) {
      inbound.push(key)
    }
  }

  const root = roots.get(fromKey)
  const refs = new Set<string>()
  for (const raw of root?.items ?? []) refs.add(unwrapRef(raw))
  for (const link of parseWikilinks(root?.body ?? '')) refs.add(link.ref)
  const outbound = [...refs].filter(ref => {
    const here = resolveWikilink(ref, roots, fromVaultId)
    if (here === undefined || here === fromKey) return false
    return resolveWikilink(ref, roots, toVaultId) === undefined
  })

  return { inbound, outbound }
}

/**
 * Cap a series' repeat.end at the day before occDate.
 * Overrides at/after occDate within that series are also excluded.
 */
export function deleteFollowing(data: StoreData, occ: Occurrence): StoreData {
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const series = findSeries(entry.items, occ)
  if (!series) return data
  const occDate = occ.date
  return {
    ...data,
    entries: withEntry(data.entries, { ...entry, items: entry.items.map(i => {
      if (i.id === series.id) {
        return { ...i as RepeatPattern<OccurrenceMetadata>,
          repeat: { ...(i as RepeatPattern<OccurrenceMetadata>).repeat,
            end: { type: 'until' as const, date: dayBefore(occDate) } } }
      }
      if (!isSeries(i) && i.ownerId === series.id && i.date >= occDate) {
        return { ...i, excluded: true }
      }
      return i
    }) }),
  }
}
