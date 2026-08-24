/**
 * Unknown frontmatter keys must survive EVERY store operation — including ones
 * that don't exist yet.
 *
 * `extra` is threaded by hand through storeOps, and it is optional, so a new
 * operation that rebuilds metadata field-by-field drops it silently and still
 * type-checks. The per-scope tests in edits.test.ts cover today's operations;
 * this file adds the property that generalises over them, plus a coverage guard
 * that fails when a newly exported operation isn't covered here.
 */
import { describe, it, expect } from 'vitest'
import * as storeOps from '@/model/storeOps'
import type { StoreData, EditFields } from '@/model/storeOps'
import { parseFixture, rootsOf, NEW_TARGET, keyOf, dataOf, itemsOf, rootsIn } from './helpers'
import { entryKey } from '@/fileIO'
import { expandRange } from '@/model/expansion'
import type { Occurrence, Roots, StoreItem } from '@/types'

function fixtureData(name: string): StoreData {
  const parsed = parseFixture(name)
  return dataOf(parsed.items, rootsOf(parsed.root))
}

function occOn(items: StoreItem[], roots: Roots, dateISO: string): Occurrence {
  const occs = expandRange(items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
  const occ = occs.find(o => o.date === dateISO)
  if (!occ) throw new Error(`no occurrence on ${dateISO}`)
  return occ
}

function editFields(occ: Occurrence, over: Partial<EditFields> = {}): EditFields {
  const m = occ.metadata
  return {
    title: m.title, tags: m.tags, items: m.items,
    participants: m.participants, body: m.body ?? '',
    tracked: m.done !== undefined, done: m.done ?? false,
    priority: m.priority ?? null,
    scheduled: occ.date ? { date: occ.date, time: occ.time ?? '' } : null,
    duration: m.duration ?? '', repeat: null,
    ...over,
  }
}

/**
 * The property: any item or root that SURVIVES an operation under the same id
 * must still carry every unknown key it had going in.
 *
 * Matching by id rather than comparing wholesale is what makes this safe to
 * apply to destructive operations too — a deleted item is simply absent, and a
 * newly created one is unconstrained — while still catching the failure this
 * exists for, which is an operation rebuilding a surviving item's metadata and
 * dropping the bag.
 */
function expectExtrasPreserved(before: StoreData, after: StoreData): void {
  const beforeItems = new Map(itemsOf(before).map(i => [i.id, i]))
  for (const item of itemsOf(after)) {
    const prev = beforeItems.get(item.id)
    if (!prev?.metadata.extra) continue
    expect(item.metadata.extra, `item ${item.id} (${item.date})`).toMatchObject(prev.metadata.extra)
  }
  for (const [slug, root] of rootsIn(after)) {
    const prev = rootsIn(before).get(slug)
    if (!prev?.extra) continue
    expect(root.extra, `root ${slug}`).toMatchObject(prev.extra)
  }
}

/**
 * Every storeOps operation that can return modified StoreData, exercised against
 * a file carrying unknown keys at the root, in `defaults:`, and on an instance.
 *
 * Uses only genuinely-unknown keys: a malformed KNOWN field parked in `extra`
 * (see extractOccurrenceMetadata) is deliberately stripped when an edit writes
 * that same field, so it would fail this property for the right reason.
 */
// DIVERGING is an instance whose own unknown key differs from its series'
// (`owner: bob` under `owner: alice`). Operations that rebuild an override from
// its series are pointed at it deliberately: an operation that merges the two
// bags the wrong way round looks correct on any instance that simply AGREES
// with its series, so targeting an agreeing one would make this suite pass
// against a merge rule that silently overwrites the user's value.
const DIVERGING = '2026-04-20'
/** A generated occurrence with no backing override — exercises the create path. */
const GENERATED = '2026-04-27'
/** The series anchor. */
const ANCHOR = '2026-04-06'

const OPERATIONS: Record<string, (data: StoreData) => StoreData> = {
  'applyEdit/all': d => storeOps.applyEdit(d, occOn(itemsOf(d), rootsIn(d), ANCHOR), 'all',
    editFields(occOn(itemsOf(d), rootsIn(d), ANCHOR), { duration: '45m' }), NEW_TARGET),
  'applyEdit/single': d => storeOps.applyEdit(d, occOn(itemsOf(d), rootsIn(d), DIVERGING), 'single',
    editFields(occOn(itemsOf(d), rootsIn(d), DIVERGING), { priority: 'high' }), NEW_TARGET),
  'applyEdit/single-generated': d => storeOps.applyEdit(d, occOn(itemsOf(d), rootsIn(d), GENERATED), 'single',
    editFields(occOn(itemsOf(d), rootsIn(d), GENERATED), { priority: 'high' }), NEW_TARGET),
  'applyEdit/future': d => storeOps.applyEdit(d, occOn(itemsOf(d), rootsIn(d), GENERATED), 'future',
    editFields(occOn(itemsOf(d), rootsIn(d), GENERATED), { duration: '15m' }), NEW_TARGET),
  'applyEdit/add': d => storeOps.applyEdit(d, occOn(itemsOf(d), rootsIn(d), ANCHOR), 'add',
    editFields(occOn(itemsOf(d), rootsIn(d), ANCHOR), { scheduled: { date: '2026-08-03', time: '' } }), NEW_TARGET),
  'applyEdit/new': d => storeOps.applyEdit(d, null, 'all',
    editFields(occOn(itemsOf(d), rootsIn(d), ANCHOR), { title: 'A brand new entry' }), NEW_TARGET),
  // Patched with the SERIES' metadata, which is what applySingle does — the
  // shape that can clobber the target's own bag.
  upsertOverride: d => dataOf(
    storeOps.upsertOverride(itemsOf(d), occOn(itemsOf(d), rootsIn(d), DIVERGING), {
      metadata: storeOps.occFromAppMeta(occOn(itemsOf(d), rootsIn(d), ANCHOR).metadata),
    }),
    rootsIn(d),
  ),
  toggleDone: d => storeOps.toggleDone(d, occOn(itemsOf(d), rootsIn(d), DIVERGING)),
  'toggleDone/generated': d => storeOps.toggleDone(d, occOn(itemsOf(d), rootsIn(d), GENERATED)),
  excludeOccurrence: d => storeOps.excludeOccurrence(d, occOn(itemsOf(d), rootsIn(d), GENERATED)),
  deleteFollowing: d => storeOps.deleteFollowing(d, occOn(itemsOf(d), rootsIn(d), GENERATED)),
  // Removes its target file by design; the property still holds for every file
  // it does not touch, which is what this case pins down.
  deleteByEntryKey: d => storeOps.deleteByEntryKey(d, keyOf('some-other-file')).data,
  // Re-keys every item of one file into another vault. The root lands under a
  // NEW key, so the root half of the property is vacuous here and is asserted
  // directly in move-entry.test.ts instead; the items keep their ids, so their
  // bags are checked by the property exactly as for any other operation.
  moveEntryKey: d => storeOps.moveEntryKey(d, [...rootsIn(d).keys()][0]!, entryKey('other-vault', 'moved')),
}

/**
 * Exports that cannot drop the bag, with the reason each is safe. Anything not
 * here and not in OPERATIONS trips the coverage guard below.
 */
const EXEMPT: Record<string, string> = {
  entryKeyItems: 'pure filter over items — returns existing objects untouched',
  findSeries: 'pure lookup — returns an existing object untouched',
  seriesContext: 'read-only derivation — returns booleans plus an existing repeat spec',
  deletionEndsAfterCompletionSeries: 'predicate — returns a boolean',
  occFromAppMeta: 'metadata constructor, covered by its own test below',
  newEntryKey: 'pure key allocation — returns a string, never touches metadata',
  freeEntryKey: 'pure key allocation — returns a string, never touches metadata',
  moveLinkBreakage: 'read-only count of what a move would break — returns keys and refs',
  groupIntoEntries: 'pure regrouping — carries the same root and item objects into one map, by reference',
}

describe('unknown keys survive every store operation', () => {
  it.each(Object.keys(OPERATIONS))('%s preserves extras on surviving items', (name) => {
    const before = fixtureData('unknown-keys-series')
    const after = OPERATIONS[name]!(before)
    expectExtrasPreserved(before, after)
  })

  // Same operations against a CONTAINER-rooted file, where the unknown keys are
  // owned by FileMetadata rather than by an item — a different code path
  // (updateRoot) with its own way to drop them. The fixture's first series is
  // weekly-Monday from 2026-04-01, so it has occurrences on the same dates.
  it.each(Object.keys(OPERATIONS))('%s preserves a container root\'s extras', (name) => {
    const before = fixtureData('unknown-keys-container')
    expectExtrasPreserved(before, OPERATIONS[name]!(before))
  })

  it('occFromAppMeta carries the bag through the AppMetadata → OccurrenceMetadata conversion', () => {
    const data = fixtureData('unknown-keys-series')
    const occ = occOn(itemsOf(data), rootsIn(data), '2026-04-20')
    expect(storeOps.occFromAppMeta(occ.metadata).extra).toEqual(occ.metadata.extra)
  })

  // The guard that makes the above generalise: a newly exported operation is a
  // new chance to drop the bag silently, so it must be classified here — either
  // exercised in OPERATIONS or exempted with a reason.
  it('every exported storeOps function is either exercised or exempted', () => {
    const exported = Object.entries(storeOps)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
    const covered = new Set(Object.keys(OPERATIONS).map(k => k.split('/')[0]!))
    const unclassified = exported.filter(n => !covered.has(n) && !(n in EXEMPT))
    expect(unclassified, 'add these to OPERATIONS or EXEMPT in this file').toEqual([])
  })
})
