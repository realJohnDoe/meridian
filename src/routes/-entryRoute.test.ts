import { describe, it, expect } from 'vitest'
import { makeOcc } from '@/test-utils'
import { newEntryRoute, entryRoute, slugRoute } from './-entryRoute'

// These build the navigate() descriptors every caller of the entry routes
// passes to TanStack Router. The `?? undefined` normalisation matters: a search
// key set to undefined is dropped from the URL, whereas null or '' would be
// serialised and then fail validateSearch's typeof checks on the way back in
// (see _app.entry.new.tsx / _app.entry.$slug.tsx).
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
  it('routes to the occurrence\'s file slug, defaulting to single-occurrence scope', () => {
    expect(entryRoute(makeOcc({ fileSlug: 'standup.md', date: '2026-06-15' }))).toEqual({
      to: '/entry/$slug',
      params: { slug: 'standup.md' },
      search: { date: '2026-06-15', scope: 'single' },
    })
  })

  it('honours an explicit scope', () => {
    expect(entryRoute(makeOcc(), 'all').search.scope).toBe('all')
  })

  // The date pins which occurrence of a series is being opened;
  // _app.entry.$slug.tsx uses it to expandRange before falling back to the file.
  it('passes the occurrence date so a series opens on the right instance', () => {
    expect(entryRoute(makeOcc({ date: '2026-07-01' })).search.date).toBe('2026-07-01')
  })
})

describe('slugRoute', () => {
  it('routes to a file by slug with no search state', () => {
    expect(slugRoute('weekly-review.md')).toEqual({
      to: '/entry/$slug',
      params: { slug: 'weekly-review.md' },
      search: {},
    })
  })

  // The distinction from entryRoute: no date means _app.entry.$slug.tsx skips
  // the expandRange lookup and resolves straight from the file-occurrence map.
  it('omits date and scope entirely, unlike entryRoute', () => {
    expect(slugRoute('weekly-review.md').search).not.toHaveProperty('date')
    expect(slugRoute('weekly-review.md').search).not.toHaveProperty('scope')
  })
})
