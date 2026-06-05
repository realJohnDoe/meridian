import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '../storeItems'
import { resolveWikilink, unwrapRef } from '../../wikilinks'
import { fileEntries, targetOccurrence } from '../../meridian'
import type { StoreItem } from '../../types'
import { isRootNode } from '../../types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeItems(yamls: Array<{ slug: string; yaml: string }>): StoreItem[] {
  return yamls.flatMap(({ slug, yaml }) => parseToStoreItems(`${slug}.md`, yaml))
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
  const items = makeItems([
    { slug: 'project-alpha', yaml: ALPHA_YAML },
    { slug: 'beta-notes',    yaml: BETA_YAML  },
  ])

  it('resolves by fileSlug (primary)', () => {
    const root = resolveWikilink('project-alpha', items)
    expect(root).toBeDefined()
    expect(isRootNode(root!)).toBe(true)
    expect(root!.fileSlug).toBe('project-alpha')
  })

  it('resolves by fileSlug case-insensitively', () => {
    const root = resolveWikilink('Project-Alpha', items)
    expect(root?.fileSlug).toBe('project-alpha')
  })

  it('resolves by title alias (fallback)', () => {
    const root = resolveWikilink('Project Alpha', items)
    expect(root?.fileSlug).toBe('project-alpha')
  })

  it('title alias is case-insensitive', () => {
    const root = resolveWikilink('project alpha', items)
    expect(root?.fileSlug).toBe('project-alpha')
  })

  it('prefers fileSlug over title when both could match', () => {
    // "beta-notes" is both the fileSlug of beta-notes.md
    // and (hypothetically) could be a title — slug wins
    const root = resolveWikilink('beta-notes', items)
    expect(root?.fileSlug).toBe('beta-notes')
  })

  it('returns undefined for unknown refs', () => {
    expect(resolveWikilink('does-not-exist', items)).toBeUndefined()
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
  const items = makeItems([
    { slug: 'project-alpha', yaml: ALPHA_YAML },
    { slug: 'beta-notes',    yaml: BETA_YAML  },
  ])

  it('returns one entry per file (deduped by fileSlug)', () => {
    const entries = fileEntries(items)
    const slugs = entries.map(e => e.fileSlug)
    // No duplicates
    expect(new Set(slugs).size).toBe(slugs.length)
    // Our two files are present
    expect(slugs).toContain('project-alpha')
    expect(slugs).toContain('beta-notes')
  })

  it('carries title and tags from root node', () => {
    const entries = fileEntries(items)
    const alpha = entries.find(e => e.fileSlug === 'project-alpha')!
    expect(alpha.title).toBe('Project Alpha')
    expect(alpha.tags).toEqual(['work'])
  })

  it('supplements with NOTES_DATA for entries not in store', () => {
    // Empty store — should still return NOTES_DATA entries
    const entries = fileEntries([])
    expect(entries.length).toBeGreaterThan(0)
  })

  it('does not duplicate a file that is in both store and NOTES_DATA', () => {
    // The standup seed item has slug 'standup'; NOTES_DATA has no 'standup' entry,
    // but if we had a collision it should not duplicate.
    const entries = fileEntries(items)
    const slugCounts = entries.reduce<Record<string, number>>((acc, e) => {
      acc[e.fileSlug] = (acc[e.fileSlug] ?? 0) + 1
      return acc
    }, {})
    for (const [, count] of Object.entries(slugCounts)) {
      expect(count).toBe(1)
    }
  })
})

// ── targetOccurrence ─────────────────────────────────────────────────────────

describe('targetOccurrence', () => {
  const items = makeItems([
    { slug: 'project-alpha', yaml: ALPHA_YAML },  // 2026-05-01 (past relative to test)
    { slug: 'weekly-standup', yaml: RECUR_YAML }, // weekly recurring
  ])

  it('returns an occurrence for a file with a recurring series', () => {
    const occ = targetOccurrence('weekly-standup', items)
    expect(occ).not.toBeNull()
    expect(occ!.fileSlug).toBe('weekly-standup')
  })

  it('returns an occurrence for a standalone past item', () => {
    const occ = targetOccurrence('project-alpha', items)
    expect(occ).not.toBeNull()
    expect(occ!.fileSlug).toBe('project-alpha')
  })

  it('returns null for an unknown fileSlug', () => {
    const occ = targetOccurrence('no-such-file', items)
    expect(occ).toBeNull()
  })
})
