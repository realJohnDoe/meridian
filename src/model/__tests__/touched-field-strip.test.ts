/**
 * data-integrity survey, finding #1: an editor save used to strip EVERY
 * registry key it knows how to write out of an item's `extra` bag, whether
 * or not this particular save actually touched that field. Renaming a title
 * alone deleted an unrelated hand-authored `tags`/`done`/`priority`/`duration`
 * the model can't type — a genuine loss `roundTripLoss` never sees, because
 * it only checks the unedited round trip (see finding #5).
 *
 * `applyEdit`'s `touchedKeys` parameter (threaded from `changedEditFields`,
 * `editor/save.ts`'s real caller) is what fixes this: `occMeta`/`editedEntry`
 * now strip only the `extra` keys a save is actually writing a fresh typed
 * value for. These tests exercise `storeOps.ts` directly, at the layer the
 * fix landed in; `src/editor/save.test.ts` covers the same scenario through
 * the real `saveNode` entry point the editor calls.
 */
import { describe, it, expect } from 'vitest'
import { parseFixture, rootsOf, NEW_TARGET, keyOf, dataOf, serializeKey } from './helpers'
import { applyEdit } from '@/model/storeOps'
import { changedEditFields } from '@/model/merge'
import { expandRange } from '@/model/expansion'
import type { EditFields } from '@/model'
import type { Occurrence } from '@/types'

/** The EditFields an unedited save of `occ` would carry — the load-time
 *  snapshot an open editor would hold, built the same way `entryFromOccurrence`
 *  does: typed fields fall back to their absent value, and a malformed known
 *  field (parked in `extra` — see fieldRegistry.ts) reads back as that same
 *  absent value too, exactly as the editor would see it. */
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

describe('applyEdit only strips the extra keys a save actually touched', () => {
  it('a title-only edit preserves an unrelated malformed tags/duration/priority/done', () => {
    // `malformed-known.md`: title/date are well-formed; tags/items (file-level)
    // and duration/priority/done (occurrence-level) are all written in a shape
    // the registry cannot type, so each is carried verbatim in `extra`.
    const p = parseFixture('malformed-known')
    const roots = rootsOf(p.root)
    const data = dataOf(p.items, roots)
    const occ = expandRange(p.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))[0]!

    const base = editFields(occ)
    const next = editFields(occ, { title: 'Renamed' })
    const touchedKeys = changedEditFields(base, next)
    expect([...touchedKeys]).toEqual(['title'])  // nothing else moved

    const result = applyEdit(data, occ, 'all', next, NEW_TARGET, touchedKeys)

    const item = result.entries.get(keyOf('malformed-known'))!.items[0]
    expect(item.metadata.extra).toMatchObject({ duration: [1, 2], priority: 7, done: 'yes' })
    const root = result.entries.get(keyOf('malformed-known'))!.root
    expect(root.extra).toMatchObject({ tags: 'not-a-list', items: [1, { nested: true }, '[[real-note]]'] })

    // And it round-trips to the file: the raw values still win over the
    // (still-empty) typed fallback on emission — see collapse.ts's
    // "registry key present in extra wins" rule.
    const yaml = serializeKey(result, keyOf('malformed-known'))
    expect(yaml).toContain('title: Renamed')
    expect(yaml).toContain('tags: not-a-list')
    expect(yaml).toContain('duration:\n  - 1\n  - 2')
    expect(yaml).toContain('priority: 7')
    expect(yaml).toContain('done: yes')
  })

  it('touching duration strips only duration, not the sibling malformed fields', () => {
    const p = parseFixture('malformed-known')
    const roots = rootsOf(p.root)
    const data = dataOf(p.items, roots)
    const occ = expandRange(p.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))[0]!

    const base = editFields(occ)
    const next = editFields(occ, { duration: '30m' })
    const touchedKeys = changedEditFields(base, next)
    expect([...touchedKeys]).toEqual(['duration'])

    const result = applyEdit(data, occ, 'all', next, NEW_TARGET, touchedKeys)
    const item = result.entries.get(keyOf('malformed-known'))!.items[0]

    // The retyped field wins over the stale raw one it shadows...
    expect(item.metadata.duration).toBe('30m')
    expect(item.metadata.extra?.duration).toBeUndefined()
    // ...but priority/done, which this save never mentioned, keep their raw values.
    expect(item.metadata.extra).toMatchObject({ priority: 7, done: 'yes' })
  })

  it('touching only `tracked` still strips a malformed `done` (they share one typed field)', () => {
    // occMeta derives the typed `done` from `f.tracked ? f.done : undefined` —
    // touching `tracked` alone changes what gets written for `done` just as
    // much as touching `done` itself, so it must count as touching `done` too.
    const p = parseFixture('malformed-known')
    const roots = rootsOf(p.root)
    const data = dataOf(p.items, roots)
    const occ = expandRange(p.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))[0]!

    const base = editFields(occ)
    const next = editFields(occ, { tracked: true })
    const touchedKeys = changedEditFields(base, next)
    expect([...touchedKeys]).toEqual(['tracked'])

    const result = applyEdit(data, occ, 'all', next, NEW_TARGET, touchedKeys)
    const item = result.entries.get(keyOf('malformed-known'))!.items[0]

    expect(item.metadata.extra?.done).toBeUndefined()
    // priority/duration, untouched, still carry their raw values.
    expect(item.metadata.extra).toMatchObject({ priority: 7, duration: [1, 2] })
  })

  it('omitting touchedKeys keeps the old strip-everything behaviour', () => {
    // Backward compatibility: every existing caller (the debug view, and
    // every test that calls applyEdit with five arguments) gets the same
    // result as before this parameter existed.
    const p = parseFixture('malformed-known')
    const roots = rootsOf(p.root)
    const data = dataOf(p.items, roots)
    const occ = expandRange(p.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))[0]!

    const result = applyEdit(data, occ, 'all', editFields(occ, { title: 'Renamed' }), NEW_TARGET)

    const item = result.entries.get(keyOf('malformed-known'))!.items[0]
    expect(item.metadata.extra).toBeUndefined()
    const root = result.entries.get(keyOf('malformed-known'))!.root
    expect(root.extra).toBeUndefined()
  })
})
