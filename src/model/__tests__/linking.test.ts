import { describe, it, expect } from 'vitest'
import { addDays, addYears, subMonths } from 'date-fns'
import { parseToStoreItems } from '@/model/storeItems'
import { resolveWikilink, buildResolveIndex, unwrapRef } from '@/wikilinks'
import { fileEntries, buildBacklinkIndex, updateFileOccurrenceMap, fileOccurrenceMap } from '@/fileOccurrence'
import { toggleDone } from '@/model/storeOps'
import type { StoreItem, Roots, Occurrence, Entries, Entry } from '@/types'
import type { StoreData } from '@/model'
import { firstOccurrenceFrom, expandRange, fmtISO } from '@/model'
import type { EntryKey } from '@/fileIO'
import { entryKey } from '@/fileIO'
import { TEST_VAULT, keyOf, itemsOf, rootsIn } from './helpers'

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The flat `items`/`roots` pair, for the resolvers below that still take one —
 * `resolveWikilink` and the occurrence map both work across every entry at
 * once, so a flat view is what they want.
 */
function makeFlat(yamls: Array<{ slug: string; yaml: string }>): { items: StoreItem[]; roots: Roots } {
  const data = makeStore(yamls)
  return { items: itemsOf(data), roots: rootsIn(data) }
}

function makeStore(yamls: Array<{ slug: string; yaml: string }>): StoreData {
  const entries: Entries = new Map()
  for (const { slug, yaml } of yamls) {
    entries.set(keyOf(slug), parseToStoreItems(`${slug}.md`, yaml, TEST_VAULT))
  }
  return { entries }
}

const ALPHA_YAML = `---
title: Project Alpha
tags: [work]
date: "2026-05-01"
done: false
---
`

const BETA_YAML = `---
title: Beta Notes
tags: [personal]
date: "2026-06-10"
---
`

const RECUR_YAML = `---
title: Weekly Standup
tags: [work]
date: "2026-04-07"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
---
`

// ── resolveWikilink ───────────────────────────────────────────────────────────

describe('resolveWikilink', () => {
  const { roots } = makeFlat([
    { slug: 'project-alpha', yaml: ALPHA_YAML },
    { slug: 'beta-notes',    yaml: BETA_YAML  },
  ])

  it('resolves by fileSlug (primary)', () => {
    const target = resolveWikilink('project-alpha', roots, TEST_VAULT)
    expect(target).toBeDefined()
    expect(target).toBe(keyOf('project-alpha'))
  })

  it('resolves by fileSlug case-insensitively', () => {
    const target = resolveWikilink('Project-Alpha', roots, TEST_VAULT)
    expect(target).toBe(keyOf('project-alpha'))
  })

  it('resolves by title alias (fallback)', () => {
    const target = resolveWikilink('Project Alpha', roots, TEST_VAULT)
    expect(target).toBe(keyOf('project-alpha'))
  })

  it('title alias is case-insensitive', () => {
    const target = resolveWikilink('project alpha', roots, TEST_VAULT)
    expect(target).toBe(keyOf('project-alpha'))
  })

  it('prefers fileSlug over title when both could match', () => {
    // "beta-notes" is both the fileSlug of beta-notes.md
    // and (hypothetically) could be a title — slug wins
    const target = resolveWikilink('beta-notes', roots, TEST_VAULT)
    expect(target).toBe(keyOf('beta-notes'))
  })

  it('returns undefined for unknown refs', () => {
    expect(resolveWikilink('does-not-exist', roots, TEST_VAULT)).toBeUndefined()
  })
})

// ── vault scoping ─────────────────────────────────────────────────────────────
//
// Files store a bare `[[slug]]`, so a link means "the entry with this slug in
// the vault the linking file itself lives in". These pin that: two vaults may
// hold the same slug, and neither resolution nor backlinks may cross between
// them.

describe('per-vault link resolution', () => {
  const WORK = 'work'
  const PERSONAL = 'personal'

  /** The same slug parsed into two different vaults, each linking to it by slug. */
  function twoVaults(): Roots {
    const roots: Roots = new Map()
    for (const vault of [WORK, PERSONAL]) {
      const notes = parseToStoreItems('notes.md', `---\ntitle: ${vault} notes\ntags: []\n---\n`, vault)
      const hub = parseToStoreItems(
        'hub.md',
        `---\ntitle: ${vault} hub\ntags: []\nitems: ["[[notes]]"]\n---\n`,
        vault,
      )
      roots.set(entryKey(vault, 'notes'), notes.root)
      roots.set(entryKey(vault, 'hub'), hub.root)
    }
    return roots
  }

  it('resolves the same bare slug to a different entry in each vault', () => {
    const roots = twoVaults()
    expect(resolveWikilink('notes', roots, WORK)).toBe(entryKey(WORK, 'notes'))
    expect(resolveWikilink('notes', roots, PERSONAL)).toBe(entryKey(PERSONAL, 'notes'))
  })

  it('returns undefined for a slug that exists only in another vault', () => {
    const roots: Roots = new Map()
    const only = parseToStoreItems('secret.md', '---\ntitle: Secret\ntags: []\n---\n', WORK)
    roots.set(entryKey(WORK, 'secret'), only.root)
    expect(resolveWikilink('secret', roots, WORK)).toBe(entryKey(WORK, 'secret'))
    expect(resolveWikilink('secret', roots, PERSONAL)).toBeUndefined()
  })

  it('does not match a title alias across a vault boundary', () => {
    const roots = twoVaults()
    // "work notes" is a title in WORK only.
    expect(resolveWikilink('work notes', roots, WORK)).toBe(entryKey(WORK, 'notes'))
    expect(resolveWikilink('work notes', roots, PERSONAL)).toBeUndefined()
  })

  it('partitions buildResolveIndex by vault, agreeing with resolveWikilink', () => {
    const roots = twoVaults()
    const index = buildResolveIndex(roots)
    for (const vault of [WORK, PERSONAL]) {
      for (const ref of ['notes', 'hub', 'work notes', 'personal notes', 'nope']) {
        expect(index.get(vault)?.get(ref.toLowerCase())).toBe(resolveWikilink(ref, roots, vault))
      }
    }
  })

  it('keeps backlinks inside their own vault', () => {
    const backlinks = buildBacklinkIndex(twoVaults())
    // Each hub links `[[notes]]`; each notes must list only its own vault's hub.
    expect(backlinks.get(entryKey(WORK, 'notes'))).toEqual([entryKey(WORK, 'hub')])
    expect(backlinks.get(entryKey(PERSONAL, 'notes'))).toEqual([entryKey(PERSONAL, 'hub')])
  })

  it('offers file-picker entries from one vault only', () => {
    const entries = fileEntries(twoVaults(), WORK)
    expect(entries.map(e => e.entryKey).sort())
      .toEqual([entryKey(WORK, 'hub'), entryKey(WORK, 'notes')].sort())
    // The bare slug is what a picker writes into the file — never the key.
    expect(entries.map(e => e.fileSlug).sort()).toEqual(['hub', 'notes'])
  })
})

// ── unwrapRef ─────────────────────────────────────────────────────────────────

describe('unwrapRef', () => {
  it('strips [[ ]] brackets', () => {
    expect(unwrapRef('[[project-alpha]]')).toBe('project-alpha')
  })

  it('passes through plain strings unchanged', () => {
    expect(unwrapRef('project-alpha')).toBe('project-alpha')
  })
})

// ── fileEntries ───────────────────────────────────────────────────────────────

describe('fileEntries', () => {
  const { roots } = makeFlat([
    { slug: 'project-alpha', yaml: ALPHA_YAML },
    { slug: 'beta-notes',    yaml: BETA_YAML  },
  ])

  it('returns one entry per file (deduped by fileSlug)', () => {
    const entries = fileEntries(roots)
    const slugs = entries.map(e => e.fileSlug)
    // No duplicates
    expect(new Set(slugs).size).toBe(slugs.length)
    // Our two files are present
    expect(slugs).toContain('project-alpha')
    expect(slugs).toContain('beta-notes')
  })

  it('carries title and tags from root node', () => {
    const entries = fileEntries(roots)
    const alpha = entries.find(e => e.fileSlug === 'project-alpha')!
    expect(alpha.title).toBe('Project Alpha')
    expect(alpha.tags).toEqual(['work'])
  })

  it('returns empty array for empty roots', () => {
    const entries = fileEntries(new Map())
    expect(entries).toHaveLength(0)
  })

  it('does not duplicate entries (one per fileSlug)', () => {
    const entries = fileEntries(roots)
    const slugCounts = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.fileSlug] = (acc[e.fileSlug] ?? 0) + 1
      return acc
    }, {})
    for (const [, count] of Object.entries(slugCounts)) {
      expect(count).toBe(1)
    }
  })
})

// ── buildResolveIndex (parity with resolveWikilink) ──────────────────────────

describe('buildResolveIndex', () => {
  const { roots } = makeFlat([
    { slug: 'project-alpha', yaml: ALPHA_YAML },
    { slug: 'beta-notes',    yaml: BETA_YAML  },
  ])

  it('agrees with resolveWikilink for every ref shape', () => {
    const index = buildResolveIndex(roots)
    const refs = [
      'project-alpha',   // fileSlug
      'Project-Alpha',   // fileSlug, mixed case
      'Project Alpha',   // title alias
      'project alpha',   // title alias, lowercased
      'beta-notes',      // fileSlug preferred
      'Beta Notes',      // title alias
      'does-not-exist',  // unknown → undefined on both sides
    ]
    for (const ref of refs) {
      expect(index.get(TEST_VAULT)?.get(ref.toLowerCase())).toBe(resolveWikilink(ref, roots, TEST_VAULT))
    }
  })
})

// ── buildBacklinkIndex ───────────────────────────────────────────────────────

describe('buildBacklinkIndex', () => {
  // alpha self-links and links to beta; the others link to alpha by fileSlug,
  // by title alias, and (delta) via both — delta must still be counted once.
  const withItems = (title: string, items: string[]) =>
    `---\ntitle: ${title}\ntags: []\nitems: [${items.map(i => `"${i}"`).join(', ')}]\n---\n`
  const { roots } = makeFlat([
    { slug: 'project-alpha', yaml: withItems('Project Alpha', ['[[project-alpha]]', '[[beta-notes]]']) },
    { slug: 'beta-notes',    yaml: withItems('Beta Notes',    ['[[project-alpha]]']) },
    { slug: 'gamma-doc',     yaml: withItems('Gamma Doc',     ['[[Project Alpha]]']) },
    { slug: 'delta-doc',     yaml: withItems('Delta Doc',     ['[[project-alpha]]', '[[Project Alpha]]']) },
  ])
  const backlinks = buildBacklinkIndex(roots)

  it('collects sources that link by fileSlug and by title alias', () => {
    // beta (fileSlug), gamma (title alias), delta (both) — in roots iteration order.
    expect(backlinks.get(keyOf('project-alpha'))).toEqual([keyOf('beta-notes'), keyOf('gamma-doc'), keyOf('delta-doc')])
  })

  it('excludes self-links', () => {
    // alpha links to itself but must not appear in its own sources.
    expect(backlinks.get(keyOf('project-alpha'))).not.toContain(keyOf('project-alpha'))
  })

  it('lists a source once even when it links the same target twice', () => {
    // delta links to alpha via both fileSlug and title alias — counted once.
    const alphaSources = backlinks.get(keyOf('project-alpha')) ?? []
    expect(alphaSources.filter(s => s === keyOf('delta-doc'))).toHaveLength(1)
  })

  it('resolves an inbound link from alpha to beta', () => {
    expect(backlinks.get(keyOf('beta-notes'))).toEqual([keyOf('project-alpha')])
  })

  it('returns an empty map for empty roots', () => {
    expect(buildBacklinkIndex(new Map()).size).toBe(0)
  })

  // Health survey finding #1: a hand-edited `items:` list containing a
  // non-string element (a bare number, plausible fat-finger for a wikilink)
  // used to reach this point untouched — extractFileMetadata only checked
  // Array.isArray(fields.items), never each element's type — and crashed
  // here with "stored.match is not a function" inside unwrapRef, taking the
  // whole vault load down instead of degrading just this one file.
  it('does not crash on a root whose items list holds a malformed element', () => {
    const { roots } = makeFlat([
      { slug: 'note', yaml: '---\ntitle: Note\ntags: []\nitems: [42, "[[real-note]]"]\n---\n' },
      { slug: 'real-note', yaml: '---\ntitle: Real Note\ntags: []\nitems: []\n---\n' },
    ])
    expect(() => buildBacklinkIndex(roots)).not.toThrow()
    expect(buildBacklinkIndex(roots).get(keyOf('real-note'))).toEqual([keyOf('note')])
  })
})

// ── firstOccurrenceFrom ───────────────────────────────────────────────────────
//
// The bounded seek `fileOccurrence.ts` uses instead of expand-then-filter
// (vault-scaling survey, finding #2). `FROM`/`HORIZON` are fixed rather than
// relative to "today", so these tests don't drift with the calendar.

const SEEK_FROM    = new Date('2026-01-01T00:00:00')
const SEEK_HORIZON = new Date('2027-01-01T00:00:00')

describe('firstOccurrenceFrom', () => {
  const WEEKLY_YAML = `---
title: Weekly Meeting
date: "2025-06-02"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
---
`
  it('agrees with expandRange + find for an unconditional predicate', () => {
    const { items, roots } = makeFlat([{ slug: 'weekly', yaml: WEEKLY_YAML }])
    const got  = firstOccurrenceFrom(items, roots, SEEK_FROM, SEEK_HORIZON, () => true)
    const want = expandRange(items, roots, SEEK_FROM, SEEK_HORIZON)[0] ?? null
    expect(got?.date).toBe(want?.date)
    expect(got?.id).toBe(want?.id)
  })

  it('returns null when nothing in [from, horizon] matches', () => {
    const { items, roots } = makeFlat([{ slug: 'weekly', yaml: WEEKLY_YAML }])
    expect(firstOccurrenceFrom(items, roots, SEEK_FROM, SEEK_HORIZON, o => o.metadata.priority === 'high')).toBeNull()
  })

  it('honours an override that excludes the nearest slot, skipping to the next one', () => {
    const yaml = `---
title: Weekly Meeting
date: "2025-06-02"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: "2026-01-05"
    excluded: true
---
`
    const { items, roots } = makeFlat([{ slug: 'weekly', yaml }])
    const got = firstOccurrenceFrom(items, roots, SEEK_FROM, SEEK_HORIZON, () => true)
    expect(got?.date).toBe('2026-01-12')
  })

  it('honours an override that changes fields on a generated slot, matching expandRange', () => {
    const yaml = `---
title: Weekly Meeting
date: "2025-06-02"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: "2026-01-05"
    priority: high
---
`
    const { items, roots } = makeFlat([{ slug: 'weekly', yaml }])
    const got  = firstOccurrenceFrom(items, roots, SEEK_FROM, SEEK_HORIZON, () => true)
    const want = expandRange(items, roots, SEEK_FROM, SEEK_HORIZON)[0]
    expect(got?.date).toBe('2026-01-05')
    expect(got?.metadata.priority).toBe('high')
    expect(got?.id).toBe(want?.id)
  })

  it('finds an off-grid override (a moved-in occurrence) ahead of the next generated slot', () => {
    const yaml = `---
title: Weekly Meeting
date: "2025-06-02"
time: "09:00"
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: "2026-01-03"
    priority: high
---
`
    const { items, roots } = makeFlat([{ slug: 'weekly', yaml }])
    const got = firstOccurrenceFrom(items, roots, SEEK_FROM, SEEK_HORIZON, () => true)
    expect(got?.date).toBe('2026-01-03')
    expect(got?.metadata.priority).toBe('high')
  })

  it('treats a standalone item as a single-element stream, merged with series by jsTime', () => {
    const { items, roots } = makeFlat([
      { slug: 'weekly',  yaml: WEEKLY_YAML },
      { slug: 'earlier', yaml: '---\ntitle: Earlier Note\ndate: "2026-01-02"\n---\n' },
    ])
    const got = firstOccurrenceFrom(items, roots, SEEK_FROM, SEEK_HORIZON, () => true)
    expect(got?.entryKey).toBe(keyOf('earlier'))
    expect(got?.date).toBe('2026-01-02')
  })
})

// ── representative occurrence resolution ─────────────────────────────────────
//
// buildFom is a full-rebuild helper used as the oracle for updateFileOccurrenceMap
// tests. It seeds updateFileOccurrenceMap with an empty previous state so every
// slug is re-resolved from scratch — equivalent to what the deleted
// fileOccurrenceMap export used to do, without shipping dead code in the bundle.
function buildFom(entries: Entries, roots: Roots): Map<EntryKey, Occurrence> {
  return updateFileOccurrenceMap(new Map(), new Map(), entries, roots)
}


const NOTE_YAML = `---
title: Grocery List
tags: [shopping]
done: false
---
`

const FAR_PAST_YAML = `---
title: Old Project
tags: []
date: "2020-01-01"
done: false
---
`

describe('representative occurrence resolution', () => {
  it('returns an occurrence for a file with a recurring series', () => {
    const data = makeStore([{ slug: 'weekly-standup', yaml: RECUR_YAML }])
    const map = buildFom(data.entries, rootsIn(data))
    expect(map.get(keyOf('weekly-standup'))).toBeDefined()
    expect(map.get(keyOf('weekly-standup'))!.entryKey).toBe(keyOf('weekly-standup'))
  })

  it('returns an occurrence for a standalone past item', () => {
    const data = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map = buildFom(data.entries, rootsIn(data))
    expect(map.get(keyOf('project-alpha'))).toBeDefined()
    expect(map.get(keyOf('project-alpha'))!.entryKey).toBe(keyOf('project-alpha'))
  })

  it('returns undefined for an unknown fileSlug (slug not in roots)', () => {
    const data = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map = buildFom(data.entries, rootsIn(data))
    expect(map.get(keyOf('no-such-file'))).toBeUndefined()
  })

  it('(original bug) dateless note resolves to its real store occurrence', () => {
    // Before fileOccurrenceMap: handleOpenWikilink used targetOccurrence (expandRange)
    // which skips undated items, then fell through to create-new. This test confirms
    // the total map covers undated notes so the click handler can open them.
    const data = makeStore([{ slug: 'grocery-list', yaml: NOTE_YAML }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('grocery-list'))
    expect(occ).toBeDefined()
    expect(occ!.entryKey).toBe(keyOf('grocery-list'))
    // Dateless note — date field is empty string
    expect(occ!.date).toBe('')
  })

  it('out-of-±3yr-window single dated item resolves via step-2 standalone fill', () => {
    // FAR_PAST_YAML has date 2020-01-01, well outside the ±3yr window from 2026.
    // expandRange won't produce it; step 2 (isStandaloneOcc) must catch it.
    const data = makeStore([{ slug: 'old-project', yaml: FAR_PAST_YAML }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('old-project'))
    expect(occ).toBeDefined()
    expect(occ!.entryKey).toBe(keyOf('old-project'))
    expect(occ!.date).toBe('2020-01-01')
  })

  it('is total — every slug present in roots has a .get() hit', () => {
    const data = makeStore([
      { slug: 'project-alpha',  yaml: ALPHA_YAML   },
      { slug: 'beta-notes',     yaml: BETA_YAML    },
      { slug: 'weekly-standup', yaml: RECUR_YAML   },
      { slug: 'grocery-list',   yaml: NOTE_YAML    },
      { slug: 'old-project',    yaml: FAR_PAST_YAML },
    ])
    const roots = rootsIn(data)
    const map = buildFom(data.entries, roots)
    for (const slug of roots.keys()) {
      expect(map.get(slug), `missing slug: ${slug}`).toBeDefined()
    }
  })

  it('prefers undated open occurrence over done dated one', () => {
    // Regression: after marking an instance done (with a date) and adding a new
    // undated open instance, the map was returning the done dated one because
    // Step 2 skipped the undated standalone when the slug was already mapped.
    const DONE_DATED_PLUS_UNDATED_OPEN = `---
title: Bargeld
defaults:
  priority: low
instances:
  - date: "2026-06-06"
    done: true
  - done: false
---
`
    const data = makeStore([{ slug: 'bargeld', yaml: DONE_DATED_PLUS_UNDATED_OPEN }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('bargeld'))
    expect(occ).toBeDefined()
    expect(occ!.date).toBe('')
    expect(occ!.metadata.done).toBe(false)
  })

  it('prefers undated open over done dated occurrence when done instance is today', () => {
    // Regression: done instance dated today falls in [now, AHEAD] so step 1 was
    // returning it immediately, skipping the undated open. Step 1 now filters for
    // undone only, so the undated open wins.
    const today = new Date().toISOString().slice(0, 10)
    const DONE_TODAY_PLUS_UNDATED_OPEN = `---
title: Sync Bug
instances:
  - date: "${today}"
    done: true
  - done: false
---
`
    const data = makeStore([{ slug: 'sync-bug', yaml: DONE_TODAY_PLUS_UNDATED_OPEN }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('sync-bug'))
    expect(occ).toBeDefined()
    expect(occ!.date).toBe('')
    expect(occ!.metadata.done).toBe(false)
  })

  it('prefers an undone scheduled (dated) task over an undone unscheduled (undated) one', () => {
    // Regression: the priority order is future events -> undone scheduled
    // tasks -> undone unscheduled tasks -> past events -> done tasks, but the
    // undated open task was being resolved ahead of the dated open one.
    const DATED_PLUS_UNDATED_OPEN = `---
title: Undated Priority Bug
instances:
  - date: "2026-08-25"
    done: false
    priority: low
  - done: false
    priority: low
---
`
    const data = makeStore([{ slug: 'undated-priority-bug', yaml: DATED_PLUS_UNDATED_OPEN }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('undated-priority-bug'))
    expect(occ).toBeDefined()
    expect(occ!.date).toBe('2026-08-25')
    expect(occ!.metadata.done).toBe(false)
  })

  it('is total over the store, including an entry whose only occurrence is undated', () => {
    // The reported bug: an entry whose root survived with zero occurrences had
    // no place in the map, so the search results list reserved a row for it and
    // drew nothing — an invisible gap where the entry should have been. The map
    // used to close that hole with an explicit sweep that synthesized a
    // representative for every root it had not already resolved.
    //
    // That sweep is gone, because the hole is: `Entry['items']` is non-empty,
    // so every key in the store has items to resolve from and the map is total
    // by construction. What is pinned here is the case the sweep was really
    // for — a file carrying only file-level fields, which parses into one
    // undated occurrence and must still get a representative.
    // parseToStoreItems returns an `Entry` directly (see `ParseResult`), so it
    // drops straight into the entries map alongside the others.
    const rootOnly = parseToStoreItems('handy.md', '---\ntitle: handy\ntags: [errands]\n---\n', TEST_VAULT)
    const data = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const allEntries: Entries = new Map(data.entries).set(keyOf('handy'), rootOnly)
    const allRoots = rootsIn({ entries: allEntries })

    const map = buildFom(allEntries, allRoots)

    // Total: every key the store holds resolves to something.
    for (const key of allRoots.keys()) expect(map.get(key)).toBeDefined()
    const occ = map.get(keyOf('handy'))
    expect(occ!.entryKey).toBe(keyOf('handy'))
    expect(occ!.metadata.title).toBe('handy')
    expect(occ!.date).toBe('')
  })

  it('drops a key whose items are gone, rather than keeping the occurrence they resolved to', () => {
    // The incremental path must not let a key that has just lost its items keep
    // pointing at an occurrence resolved from them. Losing every item now means
    // losing the entry, so the key leaves the map entirely — where it used to
    // fall through to a synthesized root-only representative.
    const data = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const withItems = buildFom(data.entries, rootsIn(data))
    expect(withItems.get(keyOf('project-alpha'))!.date).not.toBe('')

    const after = updateFileOccurrenceMap(withItems, data.entries, new Map(), new Map())

    expect(after.has(keyOf('project-alpha'))).toBe(false)
  })

  it('returns equal maps for identical inputs', () => {
    const data = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map1 = buildFom(data.entries, rootsIn(data))
    const map2 = buildFom(data.entries, rootsIn(data))
    expect([...map1.entries()]).toStrictEqual([...map2.entries()])
  })

  // ── bounded-window edge cases (vault-scaling finding #2) ──────────────────

  it('a series whose only occurrences fall beyond the forward horizon still lands on rule 6\'s synthetic anchor', () => {
    const farFuture = fmtISO(addYears(new Date(), 5))
    const yaml = `---
title: Distant Future Meeting
date: "${farFuture}"
repeat:
  type: schedule
  freq: yearly
---
`
    const data = makeStore([{ slug: 'distant-future', yaml }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('distant-future'))
    expect(occ).toBeDefined()
    expect(occ!.date).toBe(farFuture)
    expect(occ!.source).toBe('explicit') // rule 6's synthesized anchor, not a real expansion
  })

  it('(behaviour change) a file with several events older than OVERDUE_LOOKBACK_DAYS falls to rule 6, returning the first item rather than the most recent', () => {
    // Both dates sit outside the new 365-day back window but would have been
    // inside the old ±3yr one — the differential zone this rewrite creates.
    // The older one is listed first, so rule 6 (first standalone as-is) and
    // the old rule 4 (most recent past event) disagree on which one wins.
    const older = fmtISO(addDays(new Date(), -800))
    const newer = fmtISO(addDays(new Date(), -400))
    const yaml = `---
title: Old Events
instances:
  - date: "${older}"
  - date: "${newer}"
---
`
    const data = makeStore([{ slug: 'old-events', yaml }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('old-events'))
    expect(occ).toBeDefined()
    expect(occ!.date).toBe(older)
  })

  it('rule 2 finds an undone task 11 months overdue via the fixed back window', () => {
    // Within OVERDUE_LOOKBACK_DAYS (365 days), so the back window must catch
    // it — the case a forward-only seek from `now` would get wrong, since an
    // overdue task lies in the past relative to `now`.
    const elevenMonthsAgo = fmtISO(subMonths(new Date(), 11))
    const yaml = `---
title: Very Overdue Task
instances:
  - date: "${elevenMonthsAgo}"
    done: false
---
`
    const data = makeStore([{ slug: 'very-overdue', yaml }])
    const map = buildFom(data.entries, rootsIn(data))
    const occ = map.get(keyOf('very-overdue'))
    expect(occ).toBeDefined()
    expect(occ!.date).toBe(elevenMonthsAgo)
    expect(occ!.metadata.done).toBe(false)
  })
})

// ── updateFileOccurrenceMap ───────────────────────────────────────────────────
//
// Guard tests: the incremental map must be semantically equivalent to a full
// fileOccurrenceMap rebuild at every step. We compare all fields except `id`
// (a rebuild after an override upsert can carry a different backing item for
// an otherwise-equivalent occurrence) and `metadata.jsTime` (Date objects
// computed fresh each time).

function occKey(occ: Occurrence) {
  return {
    entryKey: occ.entryKey,
    date:     occ.date,
    time:     occ.time,
    source:   occ.source,
    ownerId:  (occ as Occurrence & { ownerId?: string }).ownerId,
    done:     occ.metadata.done,
    title:    occ.metadata.title,
    priority: occ.metadata.priority,
  }
}

function assertMapsEquivalent(incremental: Map<EntryKey, Occurrence>, full: Map<EntryKey, Occurrence>) {
  expect(incremental.size).toBe(full.size)
  for (const [slug, fullOcc] of full) {
    const incOcc = incremental.get(slug)
    expect(incOcc, `slug "${slug}" missing from incremental map`).toBeDefined()
    expect(occKey(incOcc!)).toStrictEqual(occKey(fullOcc))
  }
}

const TASK_YAML = `---
title: My Task
date: "2026-07-01"
done: false
---
`

const FUTURE_YAML = `---
title: Future Event
date: "2027-01-15"
done: false
---
`

describe('updateFileOccurrenceMap', () => {
  it('unchanged snapshot reuses all cached entries', () => {
    const data = makeStore([
      { slug: 'project-alpha',  yaml: ALPHA_YAML },
      { slug: 'weekly-standup', yaml: RECUR_YAML },
    ])
    const roots = rootsIn(data)
    const prevFom = buildFom(data.entries, roots)

    const incremental = updateFileOccurrenceMap(prevFom, data.entries, data.entries, roots)
    // All entries reused — verify every slug resolves to the same reference.
    for (const [slug, prevOcc] of prevFom) {
      expect(incremental.get(slug)).toBe(prevOcc)
    }
  })

  it('toggleDone on one slug re-resolves only that slug', () => {
    const base = makeStore([
      { slug: 'my-task',        yaml: TASK_YAML  },
      { slug: 'future-event',   yaml: FUTURE_YAML },
    ])
    const prevFom = buildFom(base.entries, rootsIn(base))
    const taskOcc = prevFom.get(keyOf('my-task'))!

    const next = toggleDone(base, taskOcc)

    const incremental = updateFileOccurrenceMap(prevFom, base.entries, next.entries, rootsIn(next))
    const full        = buildFom(next.entries, rootsIn(next))
    assertMapsEquivalent(incremental, full)

    // Unchanged slug reuses the cached reference.
    expect(incremental.get(keyOf('future-event'))).toBe(prevFom.get(keyOf('future-event')))
    // Changed slug has updated done value.
    expect(incremental.get(keyOf('my-task'))!.metadata.done).toBe(!taskOcc.metadata.done)
  })

  it('adding a new file includes it in the incremental map', () => {
    const base = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const prevFom = buildFom(base.entries, rootsIn(base))

    // Extend the existing snapshot with the new file's entry, reusing
    // project-alpha's entry reference unchanged.
    const added = makeStore([{ slug: 'my-task', yaml: TASK_YAML }])
    const nextEntries: Entries = new Map([...base.entries, ...added.entries])
    const nextRoots = rootsIn({ entries: nextEntries })

    const incremental = updateFileOccurrenceMap(prevFom, base.entries, nextEntries, nextRoots)
    const full        = buildFom(nextEntries, nextRoots)
    assertMapsEquivalent(incremental, full)
    expect(incremental.get(keyOf('my-task'))).toBeDefined()
    // Unchanged slug reuses the cached reference (same entry reference).
    expect(incremental.get(keyOf('project-alpha'))).toBe(prevFom.get(keyOf('project-alpha')))
  })

  it('deleting a file removes it from the incremental map', () => {
    // Build a base snapshot by combining two separately-parsed stores so that
    // entry references can be shared with the post-delete "next" snapshot.
    const alpha = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const task  = makeStore([{ slug: 'my-task',       yaml: TASK_YAML  }])
    const baseEntries: Entries = new Map([...alpha.entries, ...task.entries])
    const baseRoots = rootsIn({ entries: baseEntries })
    const prevFom = buildFom(baseEntries, baseRoots)

    // "Delete" my-task — reuse the same alpha entry reference in the next snapshot.
    const incremental = updateFileOccurrenceMap(prevFom, baseEntries, alpha.entries, rootsIn(alpha))
    const full        = buildFom(alpha.entries, rootsIn(alpha))
    assertMapsEquivalent(incremental, full)
    expect(incremental.get(keyOf('my-task'))).toBeUndefined()
  })

  it('root-only change (title rename) re-resolves affected slug', () => {
    const base = makeStore([
      { slug: 'project-alpha', yaml: ALPHA_YAML },
      { slug: 'my-task',       yaml: TASK_YAML  },
    ])
    const prevFom = buildFom(base.entries, rootsIn(base))

    // Rename project-alpha's title — new Entry reference for that key only.
    const alphaEntry = base.entries.get(keyOf('project-alpha'))!
    const renamedEntry: Entry = { ...alphaEntry, root: { ...alphaEntry.root, title: 'Project Alpha Renamed' } }
    const nextEntries = new Map(base.entries).set(keyOf('project-alpha'), renamedEntry)
    const nextRoots = rootsIn({ entries: nextEntries })

    const incremental = updateFileOccurrenceMap(prevFom, base.entries, nextEntries, nextRoots)
    const full        = buildFom(nextEntries, nextRoots)
    assertMapsEquivalent(incremental, full)
    expect(incremental.get(keyOf('project-alpha'))!.metadata.title).toBe('Project Alpha Renamed')
    // Unaffected slug reuses cached reference.
    expect(incremental.get(keyOf('my-task'))).toBe(prevFom.get(keyOf('my-task')))
  })

  it('recurring series: toggle done on a generated occurrence matches full rebuild', () => {
    const base = makeStore([
      { slug: 'weekly-standup', yaml: RECUR_YAML },
      { slug: 'my-task',        yaml: TASK_YAML  },
    ])
    const prevFom = buildFom(base.entries, rootsIn(base))
    const seriesOcc = prevFom.get(keyOf('weekly-standup'))!

    const next = toggleDone(base, seriesOcc)

    const incremental = updateFileOccurrenceMap(prevFom, base.entries, next.entries, rootsIn(next))
    const full        = buildFom(next.entries, rootsIn(next))
    assertMapsEquivalent(incremental, full)
    // Unrelated slug reuses cached reference.
    expect(incremental.get(keyOf('my-task'))).toBe(prevFom.get(keyOf('my-task')))
  })
})

// ── fileOccurrenceMap ────────────────────────────────────────────────────────
//
// The memoized read-side wrapper. This map is no longer built inside setData:
// on a 300-file vault it measured ~240 ms of blocking work before the agenda's
// first paint, for an index no cold-start view reads (its consumers are the
// editor, the search overlay, and the entry route). It is derived on demand and
// warmed during idle instead — see fileOccurrence.ts.
//
// Being called during render, the memo has to behave as a pure derivation:
// same inputs must give back the very same Map, not an equal copy.

describe('fileOccurrenceMap', () => {
  it('returns the same Map by reference for the same entries/roots', () => {
    const data = makeStore([
      { slug: 'project-alpha',  yaml: ALPHA_YAML },
      { slug: 'weekly-standup', yaml: RECUR_YAML },
    ])
    const roots = rootsIn(data)

    const first  = fileOccurrenceMap(data.entries, roots)
    const second = fileOccurrenceMap(data.entries, roots)

    expect(second).toBe(first)
  })

  it('re-derives when entries change, matching a full rebuild', () => {
    const base = makeStore([
      { slug: 'weekly-standup', yaml: RECUR_YAML },
      { slug: 'my-task',        yaml: TASK_YAML  },
    ])
    const before = fileOccurrenceMap(base.entries, rootsIn(base))

    const next = toggleDone(base, before.get(keyOf('weekly-standup'))!)
    const after = fileOccurrenceMap(next.entries, rootsIn(next))

    expect(after).not.toBe(before)
    assertMapsEquivalent(after, buildFom(next.entries, rootsIn(next)))
  })

  it('is correct even when several store writes are skipped between reads', () => {
    // Nothing forces a read per write any more, so the memo can be several
    // generations behind when a consumer finally mounts. updateFileOccurrenceMap
    // compares entries by reference, so that stays correct — just less
    // incremental.
    const base = makeStore([
      { slug: 'weekly-standup', yaml: RECUR_YAML },
      { slug: 'my-task',        yaml: TASK_YAML  },
    ])
    const seed = fileOccurrenceMap(base.entries, rootsIn(base))

    const once  = toggleDone(base, seed.get(keyOf('weekly-standup'))!)
    const twice = toggleDone(once, fileOccurrenceMap(once.entries, rootsIn(once)).get(keyOf('my-task'))!)

    // Jump straight from `base` to `twice` without reading the state between.
    const skipped = makeStore([
      { slug: 'weekly-standup', yaml: RECUR_YAML },
      { slug: 'my-task',        yaml: TASK_YAML  },
    ])
    fileOccurrenceMap(skipped.entries, rootsIn(skipped))

    assertMapsEquivalent(fileOccurrenceMap(twice.entries, rootsIn(twice)), buildFom(twice.entries, rootsIn(twice)))
  })
})
