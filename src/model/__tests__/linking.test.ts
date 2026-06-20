import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '../storeItems'
import { resolveWikilink, unwrapRef } from '../../wikilinks'
import { fileEntries, fileOccurrenceMap } from '../../presentation'
import type { StoreItem, Roots } from '../../types'

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

  it('returns the same Map instance for identical (items, roots) references (memoization)', () => {
    const { items, roots } = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map1 = fileOccurrenceMap(items, roots)
    const map2 = fileOccurrenceMap(items, roots)
    expect(map1).toBe(map2)
  })

  it('recomputes when items reference changes', () => {
    const { items, roots } = makeStore([{ slug: 'project-alpha', yaml: ALPHA_YAML }])
    const map1 = fileOccurrenceMap(items, roots)
    // Simulate a store mutation by creating a new items array reference
    const map2 = fileOccurrenceMap([...items], roots)
    expect(map1).not.toBe(map2)
  })
})
