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
import type { EntryKey, RawScalar } from '@/fileIO'
import { dayBefore } from './dateUtils'
import { stableOccId, ruleStartDate, seriesHasDay } from './expansion'
import { followDate } from './repeat'
import { deepEqual } from './fieldRegistry'
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
  /**
   * Entries the backend's listing reports but whose content has not been
   * pulled into `entries` yet — a file created on another device while this
   * one was offline, most of all. Occupied, so not available to a new entry:
   * see `slugTaken`/`newEntryKey`. Optional on the same terms as
   * `unreadableKeys`.
   */
  listedKeys?: ReadonlySet<EntryKey>
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

// `Entry['items']` is non-empty, and TypeScript drops that across `map` and a
// spread. These three put it back without a cast: each one is non-empty by
// construction, because it names the head element explicitly.

/** `items.map(f)`, keeping the non-empty guarantee. */
function mapItems(items: Entry['items'], f: (item: StoreItem) => StoreItem): Entry['items'] {
  const [head, ...tail] = items
  return [f(head), ...tail.map(f)]
}

/** `[...items, item]`, keeping the non-empty guarantee. */
function addItem(items: Entry['items'], item: StoreItem): Entry['items'] {
  const [head, ...tail] = items
  return [head, ...tail, item]
}

/**
 * `items.filter(p)` — but a filter can empty an entry, and an entry with no
 * occurrences is the state this whole shape exists to rule out. `undefined`
 * means "nothing is left of this entry", which callers turn into a deletion.
 */
function filterItems(
  items: Entry['items'],
  p: (item: StoreItem) => boolean,
): Entry['items'] | undefined {
  const [head, ...tail] = items.filter(p)
  return head ? [head, ...tail] : undefined
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
  items: Entry['items'],
  occ: Occurrence,
  patch: Partial<OccurrenceEntry<OccurrenceMetadata>>,
): Entry['items'] {
  if (!occ.ownerId) {
    return mapItems(items, i => {
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
    return mapItems(items, i =>
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
  return addItem(items, newOverride)
}

/**
 * Drop any exclusion-only stub already sitting at `date`+`time` for `ownerId`.
 *
 * An occurrence about to occupy that slot supersedes an earlier "hide this
 * slot" marker. Without this, moving an occurrence onto a slot that already
 * carries an excluded stub (e.g. moving it back to where it started, or onto
 * a slot excluded for an unrelated reason) leaves two children on the same
 * slot; `expandNode`'s override lookup returns the first array match, which
 * can be the stale excluded stub, silently hiding the real occurrence.
 *
 * Matched on time as well as date — not date alone — so this can't remove a
 * stub sitting at a *different* time on the same date, which is exactly what
 * `applySingle`'s exclude-and-detach branch writes just before calling this
 * for a same-day time move.
 */
function dropExclusionStub(items: Entry['items'], ownerId: string, date: string, time: string | null): Entry['items'] {
  // Only ever called on an entry that has `ownerId`'s series, and a series is
  // never a stub — so something always survives, and the `?? items` is
  // unreachable rather than a fallback with behaviour of its own.
  return filterItems(items, i => {
    if (isSeries(i)) return true
    const io = i
    return !(io.ownerId === ownerId && io.date === date && io.time === time && io.excluded)
  }) ?? items
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

/**
 * Which `EditFields` keys a save actually changed relative to what the editor
 * loaded — `undefined` means "unknown, treat every field as changed", the
 * default for every caller that has no such distinction to offer (a
 * brand-new entry, a rebuild of a remotely-deleted one, the debug view).
 * Threaded from `applyEdit` down to `occMeta`/`seriesMeta`/`editedEntry`,
 * which use it to decide which `extra` keys a save is entitled to strip —
 * see the "Metadata constructors" note below.
 */
type TouchedKeys = ReadonlySet<keyof EditFields> | undefined

// ── Metadata constructors ─────────────────────────────────────────────────────
//
// THE four places a metadata value is built: `occFromAppMeta` (convert),
// `mergeOccMeta` (combine two), `occMeta`/`seriesMeta` (from editor fields), and
// `editedEntry` (file level). Nothing else in this module may assemble an
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
 * The occurrence-level `extra` keys `occMeta` is about to write a fresh typed
 * value for, given which `EditFields` this save touched.
 *
 * `undefined` (the "unknown, treat everything as changed" default — see
 * `TouchedKeys`) strips all four, which is every caller's old behaviour before
 * this distinction existed. `done` maps from *either* `tracked` or `done`:
 * `occMeta` derives the typed field from both together
 * (`f.tracked ? f.done : undefined`), so a save that touched either one is
 * about to write a fresh `done` and must not leave a stale raw value parked
 * under it (data-integrity survey, finding #1).
 */
function touchedOccKeys(touched: TouchedKeys): readonly string[] {
  if (!touched) return ['participants', 'duration', 'priority', 'done']
  const keys: string[] = []
  if (touched.has('participants'))                   keys.push('participants')
  if (touched.has('duration'))                        keys.push('duration')
  if (touched.has('priority'))                        keys.push('priority')
  if (touched.has('tracked') || touched.has('done'))  keys.push('done')
  return keys
}

/** `editedEntry`'s file-level counterpart to `touchedOccKeys` — see its doc comment. */
function touchedFileKeys(touched: TouchedKeys): readonly string[] {
  if (!touched) return ['title', 'tags', 'items']
  const keys: string[] = []
  if (touched.has('title')) keys.push('title')
  if (touched.has('tags'))  keys.push('tags')
  if (touched.has('items')) keys.push('items')
  return keys
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
export function occFromAppMeta(m: { done?: boolean; participants?: string[]; priority?: Priority; duration?: string; timezone?: string; extra?: Record<string, unknown>; sources?: Record<string, RawScalar> }): OccurrenceMetadata {
  return {
    done:         m.done,
    participants: m.participants ?? [],
    priority:     m.priority,
    duration:     m.duration,
    timezone:     m.timezone,
    ...(m.extra ? { extra: m.extra } : {}),
    // Carried for the same reason as `extra`: this rebuilds the metadata field
    // by field, so anything not named here is dropped — and a dropped source
    // means the next save silently reformats a field nobody edited.
    ...(m.sources ? { sources: m.sources } : {}),
  }
}

/**
 * Build occurrence-level metadata from editor fields.
 * File-level fields (title/tags/items/body) never appear here — they go to roots.
 *
 * Strips `touched`'s registry keys out of `base.extra` (all four when
 * `touched` is `undefined` — see `TouchedKeys`): a malformed known field
 * (e.g. `duration: [1, 2]`) is preserved in `extra` under its own key, and
 * that stale raw value must not shadow a value the editor just wrote for the
 * same field. A field this save did NOT touch keeps its raw value in `extra`
 * instead — see `touchedOccKeys` and data-integrity survey finding #1: this
 * function used to strip all four unconditionally, so renaming a title alone
 * deleted an unrelated hand-authored `tags`/`done`/`priority`.
 */
function occMeta(base: Partial<OccurrenceMetadata>, f: EditFields, touched?: TouchedKeys): OccurrenceMetadata {
  return {
    ...(base as OccurrenceMetadata),
    participants: f.participants,
    duration:     f.duration || undefined,
    priority:     f.priority ?? undefined,
    done:         f.tracked ? f.done : undefined,
    extra:        withoutKeys(base.extra, touchedOccKeys(touched)),
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
function seriesMeta(base: Partial<OccurrenceMetadata>, f: EditFields, touched?: TouchedKeys): OccurrenceMetadata {
  return { ...occMeta(base, f, touched), done: f.tracked ? false : undefined }
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
 *
 * Strips `touched`'s file-level keys out of `prevRoot.extra` (all three when
 * `touched` is `undefined`) on the same rule `occMeta` applies — see
 * `touchedFileKeys` and data-integrity survey finding #1.
 */
function editedEntry(
  prev: Entry | undefined,
  key: EntryKey,
  fields: EditFields,
  items: Entry['items'],
  touched?: TouchedKeys,
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
      extra: withoutKeys(prevRoot?.extra, touchedFileKeys(touched)),
      // Carried forward like `extra` and `fileConvention`, and for the same
      // reason: not an editable field, so a rebuild that omitted it would
      // reformat every hand-quoted value at the file root on the first save
      // made through the app. No `touched` strip needed, unlike `extra` — an
      // authored source is only ever emitted while it still agrees with the
      // typed value, so an edited field discards its own (see
      // `authoredOrTyped` in collapse.ts).
      sources: prevRoot?.sources,
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

/**
 * Whether this save is asking for the repeat to be *deleted*, as opposed to
 * simply not carrying one.
 *
 * `applyScope` hands every 'single'- and 'add'-scope save a null `repeat`,
 * because at those scopes the field names this occurrence rather than the
 * series and the editor has no rule to offer. Reading that null as a deletion
 * would wipe a series whenever someone edited one of its occurrences, which is
 * why the fields alone cannot answer and everything below used to fall back to
 * `repeat ?? existing` — and why removing a repeat silently did nothing.
 *
 * `touched` is the difference: the save says which fields it is actually
 * writing (see `TouchedKeys`), so a null that *is* in the set means the user
 * cleared the rule. An absent set means "unknown, treat every field as
 * changed", which is the debug view and the rebuild paths — none of them are a
 * user clearing a repeat, and destroying a series on a maybe is not a trade
 * worth making, so those keep the old fallback.
 */
function repeatRemoved(fields: EditFields, touched?: TouchedKeys): boolean {
  return fields.repeat === null && touched?.has('repeat') === true
}

/**
 * The standalone occurrence a series becomes when its repeat is removed.
 *
 * Keeps the series' own id, mirroring `applySingle`'s standalone→series
 * conversion in the other direction: the node stays the same node, it just
 * stops having a rule. `occMeta` rather than `seriesMeta` because it is an
 * occurrence now — `seriesMeta` forces `done` to the default a child would
 * inherit, which is exactly wrong for something with no children left.
 */
function seriesToOccurrence(
  series:  RepeatPattern<OccurrenceMetadata>,
  fields:  EditFields,
  touched?: TouchedKeys,
): OccurrenceEntry<OccurrenceMetadata> {
  const { scheduled } = fields
  return {
    date:     scheduled?.date ?? '',
    time:     scheduled?.date ? scheduled.time || null : null,
    source:   'explicit',
    entryKey: series.entryKey,
    id:       series.id,
    metadata: occMeta(series.metadata, fields, touched),
  }
}

/** A non-series child of `seriesId` — an override, or an exclusion stub. */
function isChildOf(item: StoreItem, seriesId: string): boolean {
  return !isSeries(item) && item.ownerId === seriesId
}

type SeriesShape = Pick<RepeatPattern<OccurrenceMetadata>, 'date' | 'time' | 'repeat'>

/**
 * Whether going from `before` to `after` takes away `day`: the old series had an
 * occurrence there and the new one doesn't. A change stored for that day was a
 * change to an occurrence that no longer exists, so it goes — Outlook drops
 * every exception on a rule change; this keeps the ones the new rule still has a
 * day for. A child on a day the old series never produced either (an occurrence
 * moved there) didn't come from the rule and stays.
 */
function dropsDay(before: SeriesShape, after: SeriesShape, day: string): boolean {
  return seriesHasDay(before.date, before.time, before.repeat, day)
    && !seriesHasDay(after.date, after.time, after.repeat, day)
}

/**
 * The changed occurrences a save would delete — what the editor asks about
 * before letting it run (see `useEntryDialogs`' `saveAskingFirst`).
 *
 * Answered by running the save rather than restating its rules: removing a
 * repeat takes every override in its scope with it (there is no series left for
 * them to change an occurrence of), and changing a rule or a start takes the
 * ones on days the new series no longer has (`dropsDay`).
 *
 * Exclusion stubs are not counted: a stub records "don't generate this slot",
 * which is meaningless once the slot is gone, so dropping it loses the user
 * nothing they could point at.
 */
export function overridesLostTo(
  data:   StoreData,
  occ:    Occurrence,
  scope:  EditScope,
  fields: EditFields,
): OccurrenceEntry<OccurrenceMetadata>[] {
  const entry = data.entries.get(occ.entryKey)
  const series = entry && findSeries(entry.items, withLiveOwner(entry, occ))
  if (!series) return []
  const after = applyEdit(data, occ, scope, fields, { vaultId: parseEntryKey(occ.entryKey).vaultId }, new Set(['scheduled', 'repeat']))
  const kept = new Set(after.entries.get(occ.entryKey)?.items.map(i => i.id))
  return entry.items.filter((i): i is OccurrenceEntry<OccurrenceMetadata> =>
    !isSeries(i) && i.ownerId === series.id && !i.excluded && !kept.has(i.id))
}

/** Apply editor fields onto an existing series or standalone item's structural + metadata fields. */
function applyFieldsToItem(item: StoreItem, fields: EditFields, touched?: TouchedKeys): StoreItem {
  const { scheduled, repeat } = fields
  if (isSeries(item)) {
    const date = scheduled?.date ?? ''
    const nextRepeat = !repeat || deepEqual(repeat, item.repeat) ? followDate(item.repeat, item.date, date) : repeat
    const time = scheduled?.date ? scheduled.time || null : null
    // Re-anchored onto the rule only when this save moves the date or changes
    // the rule: an anchor that disagrees with its rule on purpose (hand-written,
    // or imported) is left alone by an edit that did neither.
    const reanchor = date !== item.date || !deepEqual(nextRepeat, item.repeat)
    return { ...item, metadata: seriesMeta(item.metadata, fields, touched), repeat: nextRepeat,
      date: reanchor ? ruleStartDate(date, time, nextRepeat) : date, time }
  }
  // A standalone gaining a repeat becomes a series in place — same conversion
  // `applySingle` does for scope 'single'. Without this, a repeat added at
  // scope 'all' (a brand-new entry's default scope, and "edit repeat pattern"
  // on an entry that isn't recurring yet) was silently dropped.
  if (repeat && !item.ownerId) {
    const time = scheduled?.date ? scheduled.time || null : null
    const series: RepeatPattern<OccurrenceMetadata> = {
      date:     ruleStartDate(scheduled?.date ?? '', time, repeat),
      time,
      repeat,
      entryKey: item.entryKey,
      id:       item.id,
      metadata: seriesMeta(item.metadata, fields, touched),
    }
    return series
  }
  return { ...item, metadata: occMeta(item.metadata, fields, touched),
    date: scheduled?.date ?? '', time: scheduled?.date ? scheduled.time || null : null }
}

/**
 * Carry a series' metadata change onto its override children — "all events"
 * means all events, including occurrences the user has already overridden.
 *
 * Field by field, and only where the child still holds the series' old value.
 * A child's stored metadata was materialised from the series at parse time
 * (see `effectiveNodeToStoreItems`), so a field it never overrode carries the
 * series' value and must follow the series, or collapse re-reads the stale copy
 * as a divergence and leaves that occurrence behind. A field it *did* override
 * is its own and wins (#1191) — the same per-field rule Outlook and Google
 * Calendar apply to a series-wide edit. Comparing old against new also keeps
 * a field this save never touched out of the children entirely.
 *
 * `done`, `excluded`, date/time and the unknown-key bag stay the child's own:
 * an "all events" edit must not un-complete, undelete or move an override,
 * and an edit never mints unknown keys (see the invariant above
 * `mergeOccMeta`). Only the `extra` keys it overwrites are stripped, for the
 * reason `occMeta` gives.
 */
function inheritChanges(child: OccurrenceMetadata, from: OccurrenceMetadata, to: OccurrenceMetadata): OccurrenceMetadata {
  const moved = (['participants', 'duration', 'priority'] as const)
    .filter(k => !deepEqual(from[k], to[k]) && deepEqual(child[k], from[k]))
  if (moved.length === 0) return child
  return { ...child, ...Object.fromEntries(moved.map(k => [k, to[k]])), extra: withoutKeys(child.extra, moved) }
}

function applyFieldsToChildren(items: Entry['items'], seriesId: string, from: OccurrenceMetadata, to: OccurrenceMetadata): Entry['items'] {
  return mapItems(items, i =>
    isSeries(i) || i.ownerId !== seriesId ? i : { ...i, metadata: inheritChanges(i.metadata, from, to) })
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

/**
 * True when some file already occupies `key` in this snapshot.
 *
 * Three ways to be occupied, and a snapshot that omits either optional set is
 * simply answering with less than it could — never answering "free" about
 * something it knows is taken.
 */
function slugTaken({ entries, unreadableKeys, listedKeys }: StoreData, key: EntryKey): boolean {
  return entries.has(key)
    || (unreadableKeys?.has(key) ?? false)
    || (listedKeys?.has(key) ?? false)
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
 * The key of the file this draft has already created, or undefined if its
 * first save hasn't landed yet.
 *
 * The read side of the stamp `applyNew` leaves on the item it creates. A
 * new-entry route that finds one is *resuming* a draft whose file already
 * exists — starting a second editor session on top of it (coming back to
 * `/entry/new` in history, or reloading it) is what used to leave a second
 * file beside the first.
 */
export function draftEntryKey(entries: Entries, draftId: string | undefined): EntryKey | undefined {
  return findDraft(entries, draftId)?.key
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
 * looking free — and `data.listedKeys`, so does one the backend has listed but
 * this device has not pulled yet.
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
 * search means "how a free slug is found" has one definition — including
 * everything `slugTaken` counts as occupied, which is what stops either caller
 * from landing on a file that exists but failed to parse, or on one the backend
 * has listed and this device has not read yet. `getSlugSnapshot`
 * (storeBridge.ts) is the matching single definition on the caller's side.
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
    const items = mapItems(draft.items, i => i.id === draftId ? applyFieldsToItem(i, fields) : i)
    return { ...data, entries: withEntry(entries, editedEntry(draft, draft.key, fields, items)) }
  }

  // Routed through `editedEntry` rather than a second FileMetadata literal: with
  // no previous entry it produces exactly the same shape, and there is then only
  // one place in the module where file-level metadata is assembled. The entry is
  // born with its item, not with a root that a later statement has to remember
  // to match.
  const fresh = freshItem(entryKey, fields, draftId ?? crypto.randomUUID())
  const items: Entry['items'] = prev ? addItem(prev.items, fresh) : [fresh]
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
      date:     ruleStartDate(scheduled?.date ?? '', scheduled?.time || null, repeat),
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

/**
 * Update the series (or standalone) metadata across all occurrences.
 *
 * Removing the repeat here is the one case that changes the file's shape
 * rather than its fields: the series becomes a standalone occurrence on the
 * date the form is showing (its anchor, which is what `applyScope` puts there
 * at this scope), and every override hanging off it goes with the rule they
 * were overriding. Nothing else in the file is touched — a second series
 * alongside this one, and its own children, are somebody else's occurrences.
 * The user is asked first where that loses anything; see
 * `overridesLostTo`.
 */
function applyAll(data: StoreData, occ: Occurrence, fields: EditFields, touched?: TouchedKeys): StoreData {
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const series = occ.ownerId
    ? (entry.items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined)
    : undefined
  if (series && repeatRemoved(fields, touched)) {
    const converted = seriesToOccurrence(series, fields, touched)
    const mapped = entry.items.flatMap(i =>
      i.id === series.id        ? [converted]
      : isChildOf(i, series.id) ? []
      : [i],
    )
    // The series is always in `entry.items` and always yields `converted`, so
    // the default never fires — it is how the non-empty guarantee is kept
    // without an assertion, same idiom as `applyFuture` below.
    const [head = converted, ...tail] = mapped
    const items: Entry['items'] = [head, ...tail]
    return { ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, items, touched)) }
  }
  const matchItem = occ.ownerId
    ? (i: StoreItem) => isSeries(i) && i.id === occ.ownerId
    : (i: StoreItem) => isStandaloneOcc(i) && i.id === occ.id
  let items = mapItems(entry.items, i => matchItem(i) ? applyFieldsToItem(i, fields, touched) : i)
  const before = entry.items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined
  const after = items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined
  // The series always survives the filter, so the fallback never fires.
  if (before && after) items = filterItems(items, i => !(isChildOf(i, after.id) && dropsDay(before, after, i.date))) ?? items
  // …and onto the series' override children, so "all events" reaches the
  // occurrences the user already overrode — see `applyFieldsToChildren`.
  if (before && after) items = applyFieldsToChildren(items, after.id, before.metadata, after.metadata)
  return { ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, items, touched)) }
}

/**
 * Upsert an explicit override for a single occurrence's date.
 *
 * A standalone gaining a repeat is converted to a series in place.
 * A generated occurrence moved to a different date **or time** gets excluded
 * and a detached explicit child is appended (the override key doubles as
 * recurrence-id, so an in-place date/time change would leave the original
 * generated slot un-suppressed — a same-day time move is exactly as much a
 * slot change as a date move, and needs the same treatment). Either way,
 * landing on a slot that already carries an exclusion stub (e.g. moving the
 * occurrence back to where it started) clears that stub first — see
 * `dropExclusionStub`.
 */
function applySingle(data: StoreData, occ: Occurrence, fields: EditFields, touched?: TouchedKeys): StoreData {
  const { scheduled, repeat } = fields
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const commit = (items: Entry['items']): StoreData =>
    ({ ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, items, touched)) })
  let items: Entry['items'] = entry.items
  const baseSeries = findSeries(items, occ)
  const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
  const newDate = scheduled?.date ?? ''
  const newTime = scheduled?.date ? scheduled.time || null : null

  if (repeat && !occ.ownerId) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     ruleStartDate(newDate, newTime, repeat),
      time:     newTime,
      repeat,
      entryKey: occ.entryKey,
      id:       occ.id,
      metadata: seriesMeta(base, fields, touched),
    }
    return commit(mapItems(items, i => i.id === occ.id ? newSeries : i))
  }

  if (occ.ownerId && occ.source === 'generated' && newDate && (newDate !== occ.date || newTime !== occ.time)) {
    // The occurrence keeps its id and moves; the slot it leaves gets an
    // exclusion stub under an id derived from that slot. Keeping the id is what
    // lets an editor holding this occurrence follow it to the new date — the
    // stub used to take the id instead, so the editor's next save landed on the
    // hidden stub. Both halves are idempotent: the editor can replay this save
    // with the pre-move occurrence (a debounced autosave queued before the
    // move re-rendered), which patches the same row and finds the stub present.
    items = dropExclusionStub(items, occ.ownerId, newDate, newTime)
    items = upsertOverride(items, occ, { date: newDate, time: newTime, metadata: occMeta(base, fields, touched) })
    const stubId = stableOccId(`${occ.ownerId}|excluded|${occ.date}|${occ.time ?? ''}`)
    if (items.some(i => i.id === stubId)) return commit(items)
    return commit(addItem(items, {
      date:     occ.date,
      time:     occ.time,
      source:   'explicit',
      excluded: true,
      entryKey: occ.entryKey,
      id:       stubId,
      ownerId:  occ.ownerId,
      metadata: base,
    }))
  }

  if (occ.ownerId && newDate && (newDate !== occ.date || newTime !== occ.time)) {
    items = dropExclusionStub(items, occ.ownerId, newDate, newTime)
  }

  return commit(upsertOverride(items, occ, { date: newDate, time: newTime, metadata: occMeta(base, fields, touched) }))
}

/**
 * Cap the existing series at the day before occDate and start a new sibling
 * series from occDate onward. Falls back to `applyAll` when occ is not part of
 * a series (standalone occurrence edited with scope 'future').
 *
 * **A series is never split at its own first occurrence.** Every occurrence of
 * such a series is at or after occDate, so "this and all following" is the
 * whole series — `applyAll`. Splitting anyway capped the series the day before
 * it began and stood a second one beside it, which is what a *second* 'future'
 * save in one editor session used to do: `applyEdit` re-homes the pinned
 * occurrence onto the series the first split made, that series starts on
 * occDate, and without this guard the split day grew an extra occurrence per
 * edit. It stands on its own too — opening a series' own first occurrence and
 * picking 'future' left the same dead leg.
 *
 * (An override dragged to a date *before* its series' anchor is the one case
 * this over-reaches: `applyAll` reaches it where a split would have left it
 * behind. Strictly better than the dead leg it replaces, and the alternative —
 * splitting at a date no occurrence starts on — is not a rule anyone could
 * predict.)
 */
function applyFuture(data: StoreData, occ: Occurrence, fields: EditFields, touched?: TouchedKeys): StoreData {
  const { scheduled, repeat } = fields
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const series = occ.ownerId
    ? (entry.items.find(i => isSeries(i) && i.id === occ.ownerId) as RepeatPattern<OccurrenceMetadata> | undefined)
    : undefined
  if (!series) return applyAll(data, occ, fields, touched)
  if (series.date === occ.date) return applyAll(data, occ, fields, touched)

  const occDate = occ.date
  const newSeriesId = crypto.randomUUID()
  const newDate = scheduled?.date ?? occDate
  const newRepeat = !repeat || deepEqual(repeat, series.repeat) ? followDate(series.repeat, occDate, newDate) : repeat
  const leg: SeriesShape = { date: ruleStartDate(newDate, scheduled?.time || null, newRepeat), time: scheduled?.time || null, repeat: newRepeat }
  const newMeta = seriesMeta(series.metadata, fields, touched)
  const removing = repeatRemoved(fields, touched)

  const capped: RepeatPattern<OccurrenceMetadata> = {
    ...series,
    repeat: { ...series.repeat, end: { type: 'until' as const, date: dayBefore(occDate) } },
  }
  // Removing the repeat from here on leaves a single occurrence where the new
  // series would have started — the same conversion `applyAll` does, bounded
  // to the half of the file this scope covers. The earlier occurrences keep
  // their rule; only the tail stops recurring.
  const newLeg: StoreItem = removing
    ? {
        date:     scheduled?.date ?? occDate,
        time:     scheduled?.time || null,
        source:   'explicit',
        entryKey: series.entryKey,
        id:       newSeriesId,
        metadata: occMeta(series.metadata, fields, touched),
      }
    : {
        ...leg,
        entryKey: series.entryKey,
        id:       newSeriesId,
        metadata: newMeta,
      }

  const expand = (i: StoreItem): StoreItem[] => {
    if (i.id === series.id) return [capped, newLeg]
    // Re-point overrides at/after occDate to the new series, carrying the
    // series' metadata change onto them the way `applyFieldsToChildren` does
    // for scope 'all': "this and following" covers the overridden occurrences
    // in that range too.
    //
    // Unless the rule is going: there is no new series for them to hang off,
    // so they go with it — which is what the editor asks about before letting
    // this run.
    if (!isSeries(i) && i.ownerId === series.id && i.date >= occDate) {
      return removing || dropsDay(series, leg, i.date)
        ? []
        : [{ ...i, ownerId: newSeriesId, metadata: inheritChanges(i.metadata, series.metadata, newMeta) }]
    }
    return [i]
  }
  // The series is always in `entry.items` and always yields `capped`, so the
  // default never fires — it is how the non-empty guarantee is kept without an
  // assertion, now that `expand` can also map an item to nothing.
  const [head = capped, ...tail] = entry.items.flatMap(expand)
  const items: Entry['items'] = [head, ...tail]
  return { ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, items, touched)) }
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
function applyAdd(data: StoreData, occ: Occurrence, fields: EditFields, touched?: TouchedKeys): StoreData {
  const { scheduled, repeat } = fields
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const items = entry.items
  const commit = (next: Entry['items']): StoreData =>
    ({ ...data, entries: withEntry(data.entries, editedEntry(entry, entry.key, fields, next, touched)) })
  const newDate = scheduled?.date ?? ''
  const baseSeries = findSeries(items, occ)
  const base = baseSeries?.metadata ?? occFromAppMeta(occ.metadata)
  if (repeat) {
    const newSeries: RepeatPattern<OccurrenceMetadata> = {
      date:     ruleStartDate(newDate, scheduled?.time || null, repeat),
      time:     scheduled?.time || null,
      repeat,
      entryKey: occ.entryKey,
      id:       crypto.randomUUID(),
      metadata: seriesMeta(base, fields, touched),
    }
    return commit(addItem(items, newSeries))
  }
  const newOcc: OccurrenceEntry<OccurrenceMetadata> = {
    date:    newDate,
    time:    scheduled?.time || null,
    source:  'explicit',
    entryKey: occ.entryKey,
    id:      crypto.randomUUID(),
    ownerId: occ.ownerId,
    metadata: { ...occMeta(base, fields, touched), done: fields.tracked ? false : undefined },
  }
  return commit(addItem(items, newOcc))
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
 *
 * `touchedKeys` is the set of `EditFields` the caller knows this save actually
 * changed (from `changedEditFields`) — `undefined` when it has no such
 * distinction to offer, which strips every registry key out of `extra`
 * exactly as every caller did before this parameter existed. Only
 * `editor/save.ts`'s `saveNode` computes a real set, and only when it has a
 * `base` snapshot to diff against and the scope isn't `add` (a brand-new
 * occurrence has no "unrelated field" to preserve) — see `touchedFieldsOnly`.
 * Passed through only to the four scopes below: the `occ == null` and
 * revived-entry legs above build metadata from an empty base, where stripping
 * is a no-op regardless of which keys are named.
 */
export function applyEdit(
  data: StoreData,
  occ: Occurrence | null,
  scope: EditScope,
  fields: EditFields,
  target: NewEntryTarget,
  touchedKeys?: TouchedKeys,
): StoreData {
  if (!occ) return applyNew(data, fields, target.vaultId, target.draftId)
  // The occurrence the editor is holding has no entry behind it any more — its
  // file was deleted remotely, in another tab, or by a reconcile, while the
  // editor stayed open on it. Rebuild the entry on its own key, whole.
  //
  // This used to have a second arm: an entry that was *present* but had no
  // items, which every scope below would have updated the root of and then
  // matched nothing on, leaving a root with zero occurrences. `Entry['items']`
  // is non-empty, so that arm is now a state the store cannot be in — the
  // absent entry is the only case left to handle.
  const existing = data.entries.get(occ.entryKey)
  if (!existing) {
    const items: Entry['items'] = [freshItem(occ.entryKey, fields, occ.ownerId ?? occ.id)]
    return { ...data, entries: withEntry(data.entries, editedEntry(undefined, occ.entryKey, fields, items)) }
  }
  const live = withLiveOwner(existing, occ)
  switch (scope) {
    case 'all':    return applyAll(data, live, fields, touchedKeys)
    case 'single': return applySingle(data, live, fields, touchedKeys)
    case 'future': return applyFuture(data, live, fields, touchedKeys)
    case 'add':    return applyAdd(data, live, fields, touchedKeys)
  }
}

/**
 * `occ` with its `ownerId` re-read from the store.
 *
 * An editor pins the occurrence it opened for the whole session (see
 * `EntryReady` in `routes/_entry.entry.$vault.$slug.tsx`, and `applySingle`'s
 * id-keeping move for the date-shaped half of the same staleness). Ownership is not
 * stable across that session: a 'future' save re-homes every override from
 * occDate onward onto the series it splits off, so the *next* save arrives
 * naming a series this occurrence has left.
 *
 * Every scope below keys off `ownerId` and each one breaks differently on a
 * stale one — `upsertOverride` matches `ownerId` *and* `id`, so it misses the
 * override that already exists and appends a duplicate on the same date;
 * `applyFuture` splits a series that is no longer this occurrence's. Asking the
 * store who owns it now, once, in front of the dispatch, is the fix for all
 * four at once, and it is the same question `editor/save.ts`'s `applyScope`
 * asks so that the editor's own view agrees with what lands here.
 *
 * A generated occurrence has no stored item to read, but a 'future' split
 * re-homes it all the same: the series it names is capped before its date, and
 * the leg split off from it is what produces that date now. So when the named
 * series no longer has the day, the owner is whichever series does — otherwise
 * a replayed 'future' save splits the capped series again and writes a dead leg
 * (#1192).
 */
function withLiveOwner(entry: Entry, occ: Occurrence): Occurrence {
  const stored = entry.items.find((i): i is OccurrenceEntry<OccurrenceMetadata> => !isSeries(i) && i.id === occ.id)
  const ownerId = stored ? stored.ownerId : generatedOwner(entry, occ)
  return ownerId !== occ.ownerId ? { ...occ, ownerId } : occ
}

function generatedOwner(entry: Entry, occ: Occurrence): string | undefined {
  const hasDay = (s: RepeatPattern<OccurrenceMetadata>) => seriesHasDay(s.date, s.time, s.repeat, occ.date)
  const series = entry.items.filter(isSeries)
  const named = series.find(s => s.id === occ.ownerId)
  if (!named || hasDay(named)) return occ.ownerId
  return series.find(hasDay)?.id ?? occ.ownerId
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
 * Whether `seriesId`'s after_completion series has an occurrence that is
 * neither excluded nor done — i.e. still pending completion.
 *
 * Shared by `deletionEndsAfterCompletionSeries` below (the *hypothetical* "if
 * `excludeId` were deleted, would one remain?") and `retention.ts`'s
 * `isAfterCompletionFinished` (the *current* "is one pending right now?",
 * with no exclusion) — extracted so "open" can't drift apart between the two.
 *
 * `false` is not by itself "the series is finished": a `done` occurrence
 * isn't open either, but completing it is what generates the next one
 * (`expansion.ts`), so a just-completed series still has work coming — see
 * `isAfterCompletionFinished`'s doc comment for how it tells the two apart.
 */
export function hasOpenAfterCompletionOccurrence(
  items: StoreItem[], seriesId: string, excludeId?: string,
): boolean {
  return items.some(i => {
    if (isSeries(i)) return false
    const io = i
    if (io.ownerId !== seriesId) return false
    if (excludeId !== undefined && io.id === excludeId) return false
    return !io.excluded && !io.metadata.done
  })
}

/**
 * True when deleting `occ` would end its after_completion series: `occ` is
 * the series' one open (undone, non-excluded) occurrence, and once it's gone
 * there is nothing left that could trigger the next occurrence's generation.
 */
export function deletionEndsAfterCompletionSeries(items: StoreItem[], occ: Occurrence): boolean {
  const series = findSeries(items, occ)
  if (!series || series.repeat.type !== 'after_completion') return false
  if (occ.metadata.done) return false
  return !hasOpenAfterCompletionOccurrence(items, series.id, occ.id)
}

/** True when `occ`'s entry has another live standalone occurrence besides it. */
export function hasSiblingOccurrences(items: StoreItem[], occ: Occurrence): boolean {
  return entryKeyItems(items, occ.entryKey).some(i => !isSeries(i) && i.id !== occ.id && !i.excluded)
}

/**
 * Mark a recurring occurrence as excluded; remove a standalone by id.
 *
 * Removing the last occurrence removes the entry: an entry *is* its
 * occurrences plus its file-level fields, so with none left there is nothing
 * for the root to be the file-level fields *of*, and leaving one behind is the
 * root-with-no-occurrences state this shape exists to rule out. Absence from
 * `entries` is what the write path already reads as a delete.
 *
 * In practice the UI never gets here for a lone standalone — `seriesSheet`
 * (editor/save.ts) routes a standalone with no siblings to `deleteByEntryKey`,
 * which also cleans up the backlinks a bare delete would leave dangling. This
 * is the domain layer agreeing with that rather than inventing a third answer.
 */
export function excludeOccurrence(data: StoreData, occ: Occurrence): StoreData {
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  if (occ.ownerId) {
    const items = upsertOverride(entry.items, occ, { excluded: true })
    // Root untouched, same as `toggleDone`.
    return { ...data, entries: withEntry(data.entries, { ...entry, items }) }
  }
  const items = filterItems(entry.items, i => i.id !== occ.id)
  if (!items) {
    const next = new Map(data.entries)
    next.delete(occ.entryKey)
    return { ...data, entries: next }
  }
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

// ── Archive ──────────────────────────────────────────────────────────────────

/**
 * Set or clear `archived` on an entry's file root — plans/archived-entries.md
 * PR 2. The one file-level field with no dedicated edit path (`EditFields`/
 * `editedEntry` don't carry it — the entry editor form has no control for
 * archiving), so this mirrors `moveEntryKey` immediately below rather than
 * routing through that machinery: only the root changes, `items` is carried
 * over verbatim, and — unlike a move — the key is untouched and no other
 * file's `items:` list is touched, since archiving is not a delete and has no
 * backlink cleanup.
 *
 * Clearing drops the key entirely rather than writing `archived: false`.
 * `archived` is not `required` in the field registry, so an absent key and a
 * `false` key are NOT the same on save — `absentFieldValue` for a non-required
 * boolean field is `undefined`, not `false`, so leaving `false` here would
 * write `archived: false` into the user's frontmatter forever instead of
 * reading identically to a file that was never archived. See
 * `FileMetadata.archived`'s doc comment.
 */
export function setArchived(data: StoreData, entryKey: EntryKey, archived: boolean): StoreData {
  const entry = data.entries.get(entryKey)
  if (!entry) return data
  const { archived: _drop, ...unarchived } = entry.root
  const root = archived ? { ...entry.root, archived: true } : unarchived
  return { ...data, entries: withEntry(data.entries, { ...entry, root }) }
}

// ── Cross-vault move ──────────────────────────────────────────────────────────

/**
 * Re-key one entry — every item plus its root — from `fromKey` to `toKey`.
 *
 * The whole of a move, as far as the domain is concerned: an entry's vault
 * lives in its key, so moving it between vaults is re-keying it and nothing
 * else. The root's `vaultId`/`fileSlug` are re-derived from `toKey` (never
 * copied from the old root) for the same reason `editedEntry` does it — the
 * root's provenance and the map key must be incapable of disagreeing. Every
 * other field, including `extra` and `fileConvention`, is carried over
 * verbatim: a move is not an edit of the file's contents. The one exception is
 * participants, which are a vault's own address book (its default participants
 * and the suggestions all come from it) and so are cleared rather than leaked
 * into the target vault.
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
    items: mapItems(entry.items, i => ({ ...i, entryKey: toKey, metadata: { ...i.metadata, participants: [] } })),
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
    entries: withEntry(data.entries, { ...entry, items: mapItems(entry.items, i => {
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

/**
 * Remove one series — its repeat pattern and every occurrence it owns —
 * from its file, leaving the rest of the file (other series, standalone
 * occurrences) untouched. Same scope as `deleteFollowing` (this occurrence's
 * own series, nothing wider), but removes rather than caps it.
 *
 * Callers must only reach this when the series is not the file's only
 * content — see `deleteNode` (editor/save.ts), which routes to
 * `deleteByEntryKey` instead whenever it is, the same way `excludeOccurrence`
 * leaves backlink cleanup to that function rather than duplicating it here.
 */
export function deleteSeries(data: StoreData, occ: Occurrence): StoreData {
  const entry = data.entries.get(occ.entryKey)
  if (!entry) return data
  const series = findSeries(entry.items, occ)
  if (!series) return data
  const items = filterItems(entry.items, i => i.id !== series.id && !(!isSeries(i) && i.ownerId === series.id))
  if (!items) {
    const next = new Map(data.entries)
    next.delete(occ.entryKey)
    return { ...data, entries: next }
  }
  return { ...data, entries: withEntry(data.entries, { ...entry, items }) }
}
