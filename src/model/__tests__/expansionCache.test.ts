import { describe, it, expect } from 'vitest'
import { hasSameStructure, computeExpansionCache } from '@/model/expansionCache'
import type { StoreSeries, StoreOcc, Roots } from '@/types'

// ── Fixtures ─────────────────────────────────────────────────────────────────

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-06-01',
    time: null,
    repeat: { type: 'schedule', freq: 'weekly', byweekday: ['mo'] },
    fileSlug: 'note.md',
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

function occ(overrides: Partial<StoreOcc> = {}): StoreOcc {
  return {
    date: '2026-06-01',
    time: null,
    source: 'explicit',
    fileSlug: 'note.md',
    id: 'occ-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

describe('hasSameStructure', () => {
  it('returns true for identical array references', () => {
    const a = [series()]
    expect(hasSameStructure(a, a)).toBe(true)
  })

  it('returns false when lengths differ', () => {
    expect(hasSameStructure([series()], [series(), occ()])).toBe(false)
  })

  it('treats reference-equal items as unchanged without inspecting fields', () => {
    const item = series()
    expect(hasSameStructure([item], [item])).toBe(true)
  })

  it('detects id changes', () => {
    expect(hasSameStructure([occ({ id: 'a' })], [occ({ id: 'b' })])).toBe(false)
  })

  it('detects fileSlug changes', () => {
    expect(hasSameStructure([occ({ fileSlug: 'a.md' })], [occ({ fileSlug: 'b.md' })])).toBe(false)
  })

  it('detects date changes', () => {
    expect(hasSameStructure([occ({ date: '2026-06-01' })], [occ({ date: '2026-06-02' })])).toBe(false)
  })

  it('detects time changes, treating undefined and null as equal', () => {
    expect(hasSameStructure([occ({ time: '09:00' })], [occ({ time: '10:00' })])).toBe(false)
    expect(hasSameStructure([occ({ time: null })], [occ({ time: undefined })])).toBe(true)
  })

  it('detects repeat rule changes on a series', () => {
    const a = series({ repeat: { type: 'schedule', freq: 'weekly', byweekday: ['mo'] } })
    const b = series({ repeat: { type: 'schedule', freq: 'weekly', byweekday: ['tu'] } })
    expect(hasSameStructure([a], [b])).toBe(false)
  })

  it('ignores non-structural metadata changes on a series (done/priority/participants)', () => {
    const a = series({ metadata: { participants: [], priority: 'high' } })
    const b = series({ metadata: { participants: ['x'], priority: 'low' } })
    expect(hasSameStructure([a], [b])).toBe(true)
  })

  it('treats done changes on an after_completion series as structural', () => {
    const a = series({ repeat: { type: 'after_completion', interval: '1 day' }, metadata: { participants: [], done: false } })
    const b = series({ repeat: { type: 'after_completion', interval: '1 day' }, metadata: { participants: [], done: true } })
    expect(hasSameStructure([a], [b])).toBe(false)
  })

  it('ignores done changes on a schedule-type series', () => {
    const a = series({ metadata: { participants: [], done: false } })
    const b = series({ metadata: { participants: [], done: true } })
    expect(hasSameStructure([a], [b])).toBe(true)
  })

  it('detects duration changes on a series', () => {
    const a = series({ metadata: { participants: [], duration: '1 hour' } })
    const b = series({ metadata: { participants: [], duration: '2 hours' } })
    expect(hasSameStructure([a], [b])).toBe(false)
  })

  it('detects excluded changes on an occurrence', () => {
    expect(hasSameStructure([occ({ excluded: false })], [occ({ excluded: true })])).toBe(false)
  })

  it('detects ownerId changes on an occurrence', () => {
    expect(hasSameStructure([occ({ ownerId: 'a' })], [occ({ ownerId: 'b' })])).toBe(false)
  })

  it('detects duration changes on an occurrence', () => {
    const a = occ({ metadata: { participants: [], duration: '1 day' } })
    const b = occ({ metadata: { participants: [], duration: '2 days' } })
    expect(hasSameStructure([a], [b])).toBe(false)
  })

  it('treats done changes on an override of an after_completion series as structural', () => {
    const ownerSeries = series({ id: 'owner-1', repeat: { type: 'after_completion', interval: '1 day' } })
    const a = occ({ ownerId: 'owner-1', metadata: { participants: [], done: false } })
    const b = occ({ ownerId: 'owner-1', metadata: { participants: [], done: true } })
    expect(hasSameStructure([ownerSeries, a], [ownerSeries, b])).toBe(false)
  })

  it('ignores done changes on an override of a schedule-type series', () => {
    const ownerSeries = series({ id: 'owner-1' })
    const a = occ({ ownerId: 'owner-1', metadata: { participants: [], done: false } })
    const b = occ({ ownerId: 'owner-1', metadata: { participants: [], done: true } })
    expect(hasSameStructure([ownerSeries, a], [ownerSeries, b])).toBe(true)
  })

  it('returns false when an item switches between series and occurrence', () => {
    expect(hasSameStructure([series({ id: 'x' })], [occ({ id: 'x' })])).toBe(false)
  })
})

describe('computeExpansionCache', () => {
  const from = new Date('2026-05-25T00:00:00Z')
  const to = new Date('2026-06-08T00:00:00Z')

  function rootsOf(entries: [string, { title: string; tags: string[]; items: string[] }][]): Roots {
    return new Map(entries)
  }

  it('overlays a changed file title onto cached occurrences without re-expanding, leaving other files untouched', () => {
    const a = occ({ id: 'a', fileSlug: 'note-a.md', date: '2026-06-01' })
    const b = occ({ id: 'b', fileSlug: 'note-b.md', date: '2026-06-02' })
    const items = [a, b]
    const roots1 = rootsOf([
      ['note-a.md', { title: 'Old Title', tags: [], items: [] }],
      ['note-b.md', { title: 'Note B', tags: [], items: [] }],
    ])

    const first = computeExpansionCache(null, items, roots1, from, to)
    expect(first.allOccs.find(o => o.id === 'a')?.metadata.title).toBe('Old Title')

    // Simulate editing note-a's title: storeOps.updateRoot allocates a fresh
    // map and a fresh entry for the edited slug only (see updateRoot).
    const roots2 = new Map(roots1)
    roots2.set('note-a.md', { title: 'New Title', tags: [], items: [] })

    const second = computeExpansionCache(first, items, roots2, from, to)

    // Fast path taken: allOccs array is a new array (overlay), but items didn't
    // change, so this isn't a full re-expansion — verify via title propagation.
    expect(second.allOccs.find(o => o.id === 'a')?.metadata.title).toBe('New Title')
    expect(second.allOccs.find(o => o.id === 'b')?.metadata.title).toBe('Note B')
  })

  it('returns the same allOccs reference when neither items nor roots entries changed', () => {
    const a = occ({ id: 'a', fileSlug: 'note-a.md', date: '2026-06-01' })
    const items = [a]
    const roots1 = rootsOf([['note-a.md', { title: 'Title', tags: [], items: [] }]])

    const first = computeExpansionCache(null, items, roots1, from, to)
    // New Map instance, but every entry is reference-identical to roots1's.
    const roots2 = new Map(roots1)
    const second = computeExpansionCache(first, items, roots2, from, to)

    expect(second.allOccs).toBe(first.allOccs)
  })
})
