import { describe, it, expect } from 'vitest'
import { makeOcc, testKey, TEST_VAULT } from '@/test-utils'
import { entryKey } from '@/fileIO'
import { newEntryRoute, entryRoute, keyRoute } from './entryRoute'

// These build the navigate() descriptors every caller of the entry routes
// passes to TanStack Router. The `?? undefined` normalisation matters: a search
// key set to undefined is dropped from the URL, whereas null or '' would be
// serialised and then fail validateSearch's typeof checks on the way back in
// (see _entry.entry.new.tsx / _entry.entry.$slug.tsx).
describe('newEntryRoute', () => {
  it('targets the new-entry route with every search key absent by default', () => {
    expect(newEntryRoute()).toEqual({
      to: '/entry/new',
      search: { title: undefined, date: undefined, time: undefined, duration: undefined, itemType: undefined },
    })
  })

  it('carries a title through', () => {
    expect(newEntryRoute('Standup').search.title).toBe('Standup')
  })

  it('carries a full seed through', () => {
    expect(newEntryRoute('Standup', { date: '2026-06-15', time: '09:00', duration: '30m', itemType: 'event' })).toEqual({
      to: '/entry/new',
      search: { title: 'Standup', date: '2026-06-15', time: '09:00', duration: '30m', itemType: 'event' },
    })
  })

  it('seeds without a title — the day-view create gesture supplies date/time but no name', () => {
    const { search } = newEntryRoute(undefined, { date: '2026-06-15', time: '14:00', duration: '1h', itemType: 'event' })
    expect(search.title).toBeUndefined()
    expect(search.date).toBe('2026-06-15')
  })

  it('leaves unseeded keys undefined rather than partially populated', () => {
    const { search } = newEntryRoute('Standup', { date: '2026-06-15' })
    expect(search.time).toBeUndefined()
    expect(search.duration).toBeUndefined()
    expect(search.itemType).toBeUndefined()
  })

  // `?? undefined` only collapses nullish, so '' rides along as `?title=`.
  // That is deliberate — normalising empties is the caller's job, and
  // SearchBar.tsx:99 does exactly that with `filterQuery || undefined`. Pinned
  // here so the division of labour stays visible from both sides.
  it('passes an empty title through, leaving empties for callers to normalise', () => {
    expect(newEntryRoute('').search.title).toBe('')
    expect(newEntryRoute(undefined).search.title).toBeUndefined()
  })
})

describe('entryRoute', () => {
  // The URL carries the two halves of the EntryKey as separate path segments —
  // `::` is not path-safe, and `/entry/<vault>/<slug>` reads as what it is.
  it('routes to the occurrence\'s vault and file slug, defaulting to single-occurrence scope', () => {
    expect(entryRoute(makeOcc({ entryKey: testKey('standup.md'), date: '2026-06-15', id: 'occ-1' }))).toEqual({
      to: '/entry/$vault/$slug',
      params: { vault: TEST_VAULT, slug: 'standup.md' },
      search: { date: '2026-06-15', scope: 'single', id: 'occ-1' },
    })
  })

  it('splits the same slug in two vaults into two different URLs', () => {
    const work     = entryRoute(makeOcc({ entryKey: entryKey('work', 'notes') }))
    const personal = entryRoute(makeOcc({ entryKey: entryKey('personal', 'notes') }))
    expect(work.params).toEqual({ vault: 'work', slug: 'notes' })
    expect(personal.params).toEqual({ vault: 'personal', slug: 'notes' })
  })

  it('honours an explicit scope', () => {
    expect(entryRoute(makeOcc(), 'all').search.scope).toBe('all')
  })

  // The date pins which occurrence of a series is being opened;
  // _entry.entry.$vault.$slug.tsx uses it to expandRange before falling back to the file.
  it('passes the occurrence date so a series opens on the right instance', () => {
    expect(entryRoute(makeOcc({ date: '2026-07-01' })).search.date).toBe('2026-07-01')
  })

  // Date alone doesn't disambiguate two override instances of the same file on
  // the same date (e.g. neither has a time) — `id` is what
  // _entry.entry.$vault.$slug.tsx matches on to land on the exact one clicked.
  it('passes the occurrence id so same-date siblings resolve to the right one', () => {
    expect(entryRoute(makeOcc({ id: 'occ-2' })).search.id).toBe('occ-2')
  })
})

describe('keyRoute', () => {
  it('routes to an entry by key with no search state', () => {
    expect(keyRoute(testKey('weekly-review.md'))).toEqual({
      to: '/entry/$vault/$slug',
      params: { vault: TEST_VAULT, slug: 'weekly-review.md' },
      search: {},
    })
  })

  // The distinction from entryRoute: no date means _entry.entry.$vault.$slug.tsx
  // skips the expandRange lookup and resolves straight from the file-occurrence map.
  it('omits date and scope entirely, unlike entryRoute', () => {
    expect(keyRoute(testKey('weekly-review.md')).search).not.toHaveProperty('date')
    expect(keyRoute(testKey('weekly-review.md')).search).not.toHaveProperty('scope')
  })
})
