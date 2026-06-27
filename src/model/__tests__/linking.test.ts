import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { resolveWikilink, unwrapRef } from '@/wikilinks'
import { fileEntries, fileOccurrenceMap, updateFileOccurrenceMap } from '@/fileOccurrence'
import { toggleDone } from '@/model/storeOps'
import type { StoreItem, Roots, Occurrence } from '@/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

interface StoreSnapshot { items: StoreItem[]; roots: Roots }

function makeStore(yamls: Array<{ slug: string; yaml: string }>): StoreSnapshot {
  const items: StoreItem[] = []
  const roots: Roots = new Map()
  for (const { slug, yaml } of yamls) {
    const result = parseToStoreItems(`${slug}.md`, yaml)
    items.push(...result.items)
    roots.set(slug, result.root)
  }
  return { items, roots }
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
  const { roots } = makeStore([
    { slug: 'project-alpha', yaml: ALPHA_YAML },
    { slug: 'beta-notes',    yaml: BETA_YAML  },
  ])

  it('resolves by fileSlug (primary)', () => {
    const fileSlug = resolveWikilink('project-alpha', roots)
    expect(fileSlug).toBeDefined()
    expect(fileSlug).toBe('project-alpha')
  })

  it('resolves by fileSlug case-insensitively', () => {
    const fileSlug = resolveWikilink('Project-Alpha', roots)
    expect(fileSlug).toBe('project-alpha')
  })

  it('resolves by title alias (fallback)', () => {
    const fileSlug = resolveWikilink('Project Alpha', roots)
    expect(fileSlug).toBe('project-alpha')
  })

  it('title alias is case-insensitive', () => {
    const fileSlug = resolveWikilink('project alpha', roots)
    expect(fileSlug).toBe('project-alpha')
  })

  it('prefers fileSlug over title when both could match', () => {
    // "beta-notes" is both the fileSlug of beta-notes.md
    // and (hypothetically) could be a title — slug wins
    const fileSlug = resolveWikilink('beta-notes', roots)
    expect(fileSlug).toBe('beta-notes')
  })

  it('returns undefined for unknown refs', () => {
    expect(resolveWikilink('does-not-exist', roots)).toBeUndefined()
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
  const { roots } = makeStore([
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

// ── fileOccurrenceMap ─────────────────────────────────────────────────────────

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

describe('fileOccurrenceMap', () => {
  it('returns an occurrence for a file with a recurring series', () => {
    const { items, roots } = makeStore([{ slug: 'weekly-standup', yaml: RECUR_YAML }])
    const map = fileOccurrenceMap(items, roots)
    expect(map.get('weekly-standup')).toBeDefined()
    expect(map.get('weekly-standup')!.fileSlug).toBe('weekly-standup')
  })

  it('returns an occurrence for a standalone past item', () => {
    const { items, roots } = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map = fileOccurrenceMap(items, roots)
    expect(map.get('project-alpha')).toBeDefined()
    expect(map.get('project-alpha')!.fileSlug).toBe('project-alpha')
  })

  it('returns undefined for an unknown fileSlug (slug not in roots)', () => {
    const { items, roots } = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map = fileOccurrenceMap(items, roots)
    expect(map.get('no-such-file')).toBeUndefined()
  })

  it('(original bug) dateless note resolves to its real store occurrence', () => {
    // Before fileOccurrenceMap: handleOpenWikilink used targetOccurrence (expandRange)
    // which skips undated items, then fell through to create-new. This test confirms
    // the total map covers undated notes so the click handler can open them.
    const { items, roots } = makeStore([{ slug: 'grocery-list', yaml: NOTE_YAML }])
    const map = fileOccurrenceMap(items, roots)
    const occ = map.get('grocery-list')
    expect(occ).toBeDefined()
    expect(occ!.fileSlug).toBe('grocery-list')
    // Dateless note — date field is empty string
    expect(occ!.date).toBe('')
  })

  it('out-of-±3yr-window single dated item resolves via step-2 standalone fill', () => {
    // FAR_PAST_YAML has date 2020-01-01, well outside the ±3yr window from 2026.
    // expandRange won't produce it; step 2 (isStandaloneOcc) must catch it.
    const { items, roots } = makeStore([{ slug: 'old-project', yaml: FAR_PAST_YAML }])
    const map = fileOccurrenceMap(items, roots)
    const occ = map.get('old-project')
    expect(occ).toBeDefined()
    expect(occ!.fileSlug).toBe('old-project')
    expect(occ!.date).toBe('2020-01-01')
  })

  it('is total — every slug present in roots has a .get() hit', () => {
    const { items, roots } = makeStore([
      { slug: 'project-alpha',  yaml: ALPHA_YAML   },
      { slug: 'beta-notes',     yaml: BETA_YAML    },
      { slug: 'weekly-standup', yaml: RECUR_YAML   },
      { slug: 'grocery-list',   yaml: NOTE_YAML    },
      { slug: 'old-project',    yaml: FAR_PAST_YAML },
    ])
    const map = fileOccurrenceMap(items, roots)
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
    const { items, roots } = makeStore([{ slug: 'bargeld', yaml: DONE_DATED_PLUS_UNDATED_OPEN }])
    const map = fileOccurrenceMap(items, roots)
    const occ = map.get('bargeld')
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
    const { items, roots } = makeStore([{ slug: 'sync-bug', yaml: DONE_TODAY_PLUS_UNDATED_OPEN }])
    const map = fileOccurrenceMap(items, roots)
    const occ = map.get('sync-bug')
    expect(occ).toBeDefined()
    expect(occ!.date).toBe('')
    expect(occ!.metadata.done).toBe(false)
  })

  it('returns equal maps for identical inputs', () => {
    const { items, roots } = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map1 = fileOccurrenceMap(items, roots)
    const map2 = fileOccurrenceMap(items, roots)
    expect([...map1.entries()]).toStrictEqual([...map2.entries()])
  })
})

// ── updateFileOccurrenceMap ───────────────────────────────────────────────────
//
// Guard tests: the incremental map must be semantically equivalent to a full
// fileOccurrenceMap rebuild at every step. We compare all fields except `id`
// (stableOccId UUIDs may diverge for reused entries after clearOccIdCache) and
// `metadata.jsTime` (Date objects computed fresh each time).

function occKey(occ: Occurrence) {
  return {
    fileSlug: occ.fileSlug,
    date:     occ.date,
    time:     occ.time,
    source:   occ.source,
    ownerId:  (occ as Occurrence & { ownerId?: string }).ownerId,
    done:     occ.metadata.done,
    title:    occ.metadata.title,
    priority: occ.metadata.priority,
  }
}

function assertMapsEquivalent(incremental: Map<string, Occurrence>, full: Map<string, Occurrence>) {
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
  it('initial load (empty prev) matches full rebuild', () => {
    const { items, roots } = makeStore([
      { slug: 'project-alpha',  yaml: ALPHA_YAML  },
      { slug: 'weekly-standup', yaml: RECUR_YAML  },
      { slug: 'my-task',        yaml: TASK_YAML   },
    ])
    const prevFom:   Map<string, Occurrence> = new Map()
    const prevItems: StoreItem[] = []
    const prevRoots: Roots = new Map()

    const incremental = updateFileOccurrenceMap(prevFom, prevItems, prevRoots, items, roots)
    const full        = fileOccurrenceMap(items, roots)
    assertMapsEquivalent(incremental, full)
  })

  it('unchanged snapshot reuses all cached entries', () => {
    const { items, roots } = makeStore([
      { slug: 'project-alpha',  yaml: ALPHA_YAML },
      { slug: 'weekly-standup', yaml: RECUR_YAML },
    ])
    const prevFom = fileOccurrenceMap(items, roots)

    const incremental = updateFileOccurrenceMap(prevFom, items, roots, items, roots)
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
    const prevFom = fileOccurrenceMap(base.items, base.roots)
    const taskOcc = prevFom.get('my-task')!

    const next = toggleDone(base, taskOcc)

    const incremental = updateFileOccurrenceMap(prevFom, base.items, base.roots, next.items, next.roots)
    const full        = fileOccurrenceMap(next.items, next.roots)
    assertMapsEquivalent(incremental, full)

    // Unchanged slug reuses the cached reference.
    expect(incremental.get('future-event')).toBe(prevFom.get('future-event'))
    // Changed slug has updated done value.
    expect(incremental.get('my-task')!.metadata.done).toBe(!taskOcc.metadata.done)
  })

  it('adding a new file includes it in the incremental map', () => {
    const base = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const prevFom = fileOccurrenceMap(base.items, base.roots)

    // Extend the existing snapshot by appending the new file's items/root so
    // project-alpha's item references remain identical (same objects).
    const added = makeStore([{ slug: 'my-task', yaml: TASK_YAML }])
    const nextItems = [...base.items, ...added.items]
    const nextRoots: Roots = new Map([...base.roots, ...added.roots])

    const incremental = updateFileOccurrenceMap(prevFom, base.items, base.roots, nextItems, nextRoots)
    const full        = fileOccurrenceMap(nextItems, nextRoots)
    assertMapsEquivalent(incremental, full)
    expect(incremental.get('my-task')).toBeDefined()
    // Unchanged slug reuses the cached reference (same item refs, same root ref).
    expect(incremental.get('project-alpha')).toBe(prevFom.get('project-alpha'))
  })

  it('deleting a file removes it from the incremental map', () => {
    // Build a base snapshot by combining two separately-parsed stores so that
    // item references can be shared with the post-delete "next" snapshot.
    const alpha = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const task  = makeStore([{ slug: 'my-task',       yaml: TASK_YAML  }])
    const baseItems = [...alpha.items, ...task.items]
    const baseRoots: Roots = new Map([...alpha.roots, ...task.roots])
    const prevFom = fileOccurrenceMap(baseItems, baseRoots)

    // "Delete" my-task — reuse the same alpha item refs in the next snapshot.
    const incremental = updateFileOccurrenceMap(prevFom, baseItems, baseRoots, alpha.items, alpha.roots)
    const full        = fileOccurrenceMap(alpha.items, alpha.roots)
    assertMapsEquivalent(incremental, full)
    expect(incremental.get('my-task')).toBeUndefined()
  })

  it('root-only change (title rename) re-resolves affected slug', () => {
    const base = makeStore([
      { slug: 'project-alpha', yaml: ALPHA_YAML },
      { slug: 'my-task',       yaml: TASK_YAML  },
    ])
    const prevFom = fileOccurrenceMap(base.items, base.roots)

    // Rename project-alpha's title — new Map entry = new reference for that slug.
    const newRoots: Roots = new Map(base.roots)
    newRoots.set('project-alpha', { ...base.roots.get('project-alpha')!, title: 'Project Alpha Renamed' })
    const next = { items: base.items, roots: newRoots }

    const incremental = updateFileOccurrenceMap(prevFom, base.items, base.roots, next.items, next.roots)
    const full        = fileOccurrenceMap(next.items, next.roots)
    assertMapsEquivalent(incremental, full)
    expect(incremental.get('project-alpha')!.metadata.title).toBe('Project Alpha Renamed')
    // Unaffected slug reuses cached reference.
    expect(incremental.get('my-task')).toBe(prevFom.get('my-task'))
  })

  it('recurring series: toggle done on a generated occurrence matches full rebuild', () => {
    const base = makeStore([
      { slug: 'weekly-standup', yaml: RECUR_YAML },
      { slug: 'my-task',        yaml: TASK_YAML  },
    ])
    const prevFom = fileOccurrenceMap(base.items, base.roots)
    const seriesOcc = prevFom.get('weekly-standup')!

    const next = toggleDone(base, seriesOcc)

    const incremental = updateFileOccurrenceMap(prevFom, base.items, base.roots, next.items, next.roots)
    const full        = fileOccurrenceMap(next.items, next.roots)
    assertMapsEquivalent(incremental, full)
    // Unrelated slug reuses cached reference.
    expect(incremental.get('my-task')).toBe(prevFom.get('my-task'))
  })
})
