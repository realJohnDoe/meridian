import { describe, it, expect } from 'vitest'
import { dotCategory, dayDotsFor, type DotCategory } from './dayDots'
import type { Occurrence } from '@/types'
import { makeOcc } from '@/test-utils'

function occAt(iso: string, hour: number, overrides: Partial<Occurrence> = {}): Occurrence {
  return makeOcc({
    metadata: { participants: [], title: 'x', tags: [], items: [], vaultId: 'v', fileSlug: 'note.md', jsTime: new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00`) },
    ...overrides,
  })
}

describe('dotCategory', () => {
  it.each<[string, Partial<Occurrence>, DotCategory | undefined]>([
    ['high-priority task', { metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'high' } }, 'p1'],
    ['medium-priority task', { metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'medium' } }, 'p2'],
    ['low-priority task', { metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'low' } }, 'p3'],
    ['untyped task (no priority)', { metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false } }, 'task'],
    ['completed task keeps its priority', { metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: true, priority: 'high' } }, 'p1'],
    ['timed event', { date: '2026-06-15', time: '09:00' }, 'event'],
    ['all-day event', { date: '2026-06-15', time: null }, 'event'],
    ['note (no date)', { date: '', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n' } }, undefined],
  ])('%s', (_name, overrides, expected) => {
    expect(dotCategory(makeOcc(overrides))).toBe(expected)
  })
})

describe('dayDotsFor', () => {
  it('returns an empty map for no occurrences', () => {
    expect(dayDotsFor([])).toEqual(new Map())
  })

  it('has no entry for a day with no occurrences', () => {
    const dots = dayDotsFor([occAt('2026-06-15', 9)])
    expect(dots.has('2026-06-16')).toBe(false)
  })

  it('dedupes same-category occurrences on the same day', () => {
    const dots = dayDotsFor([
      occAt('2026-06-15', 9, { id: 'a' }),
      occAt('2026-06-15', 14, { id: 'b' }),
    ])
    expect(dots.get('2026-06-15')).toEqual(['event'])
  })

  it('orders categories event -> p1 -> p2 -> p3 -> task', () => {
    const dots = dayDotsFor([
      occAt('2026-06-15', 9, { id: 'task', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, jsTime: new Date('2026-06-15T09:00:00') } }),
      occAt('2026-06-15', 10, { id: 'p3', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'low', jsTime: new Date('2026-06-15T10:00:00') } }),
      occAt('2026-06-15', 11, { id: 'event' }),
      occAt('2026-06-15', 12, { id: 'p1', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'high', jsTime: new Date('2026-06-15T12:00:00') } }),
    ])
    expect(dots.get('2026-06-15')).toEqual(['event', 'p1', 'p3', 'task'])
  })

  it('caps a day at four dots, dropping the lowest-priority category first', () => {
    const dots = dayDotsFor([
      occAt('2026-06-15', 8, { id: 'event' }),
      occAt('2026-06-15', 9, { id: 'p1', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'high', jsTime: new Date('2026-06-15T09:00:00') } }),
      occAt('2026-06-15', 10, { id: 'p2', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'medium', jsTime: new Date('2026-06-15T10:00:00') } }),
      occAt('2026-06-15', 11, { id: 'p3', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, priority: 'low', jsTime: new Date('2026-06-15T11:00:00') } }),
      occAt('2026-06-15', 12, { id: 'task', metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n', done: false, jsTime: new Date('2026-06-15T12:00:00') } }),
    ])
    expect(dots.get('2026-06-15')).toEqual(['event', 'p1', 'p2', 'p3'])
  })

  it('dots every day a multiday event covers, without deduping by id', () => {
    // Mirrors what expandWithMultiday emits: one virtual occurrence per
    // covered day, sharing the same id but distinct jsTime.
    const occs = ['2026-06-10', '2026-06-11', '2026-06-12'].map(iso =>
      occAt(iso, 0, { id: 'trip', date: '2026-06-10', metadata: { participants: [], title: 'Trip', tags: [], items: [], vaultId: 'v', fileSlug: 'n', duration: '3 days', jsTime: new Date(`${iso}T00:00:00`) } }),
    )
    const dots = dayDotsFor(occs)
    expect(dots.get('2026-06-10')).toEqual(['event'])
    expect(dots.get('2026-06-11')).toEqual(['event'])
    expect(dots.get('2026-06-12')).toEqual(['event'])
  })

  it('skips occurrences without a jsTime', () => {
    const dots = dayDotsFor([makeOcc({ metadata: { participants: [], title: '', tags: [], items: [], vaultId: 'v', fileSlug: 'n' } })])
    expect(dots.size).toBe(0)
  })
})
