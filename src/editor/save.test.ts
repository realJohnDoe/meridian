import { describe, it, expect } from 'vitest'
import { applyScope, entryFromOccurrence, saveNode } from './save'
import { makeOcc, makeSeries, setupStore, installFakePersistence, testKey, TEST_VAULT } from '@/test-utils'
import { useStore } from '@/store'
import { setUnreadableFiles } from '@/storeBridge'
import { ENTRY_DEFAULT } from './state'

describe('entryFromOccurrence', () => {
  it('derives a note when the item is untracked and unscheduled', () => {
    const occ = makeOcc({ time: null, date: '' })
    const entry = entryFromOccurrence(occ, 'single')
    expect(entry.itemType).toBe('note')
    expect(entry.tracked).toBe(false)
    expect(entry.scheduled).toBeNull()
  })

  it('derives an event when the item is scheduled but not tracked', () => {
    const occ = makeOcc()
    const entry = entryFromOccurrence(occ, 'single')
    expect(entry.itemType).toBe('event')
    expect(entry.tracked).toBe(false)
    expect(entry.scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
  })

  it('derives a task when `done` is defined, regardless of scheduling', () => {
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: [], title: 'Task', tags: [], items: [], done: false } })
    const entry = entryFromOccurrence(occ, 'single')
    expect(entry.itemType).toBe('task')
    expect(entry.tracked).toBe(true)
    expect(entry.done).toBe(false)
  })

  it('copies array-valued metadata fields instead of aliasing them', () => {
    const tags = ['work']
    const occ = makeOcc({ metadata: { vaultId: TEST_VAULT, fileSlug: 'note', participants: ['alice'], title: 'T', tags, items: [], done: true } })
    const entry = entryFromOccurrence(occ, 'single')
    entry.tags.push('mutated')
    expect(tags).toEqual(['work'])
  })
})

describe('applyScope', () => {
  it('single scope keeps only this occurrence\'s date/time and drops repeat', () => {
    const occ = makeOcc({ ownerId: 'series-1' })
    const series = makeSeries()
    const { scheduled, repeat } = applyScope(occ, 'single', [series, occ])
    expect(scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
    expect(repeat).toBeNull()
  })

  it('future scope keeps this occurrence\'s date but carries the series repeat', () => {
    const occ = makeOcc({ ownerId: 'series-1' })
    const series = makeSeries()
    const { scheduled, repeat } = applyScope(occ, 'future', [series, occ])
    expect(scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
    expect(repeat).toEqual(series.repeat)
  })

  it('all scope rolls back to the series root date/time', () => {
    const occ = makeOcc({ ownerId: 'series-1' })
    const series = makeSeries()
    const { scheduled, repeat } = applyScope(occ, 'all', [series, occ])
    expect(scheduled).toEqual({ date: '2026-06-01', time: '09:00' })
    expect(repeat).toEqual(series.repeat)
  })

  it('add scope schedules a fresh occurrence for today, with no repeat', () => {
    const occ = makeOcc()
    const { scheduled, repeat } = applyScope(occ, 'add', [occ])
    expect(scheduled?.time).toBe('09:00')
    expect(repeat).toBeNull()
  })

  it('single scope on a standalone (non-recurring) item has no series to fall back to', () => {
    const occ = makeOcc()
    const { scheduled, repeat } = applyScope(occ, 'all', [occ])
    expect(scheduled).toEqual({ date: '2026-06-15', time: '09:00' })
    expect(repeat).toBeNull()
  })
})

describe('saveNode — reserved (unreadable) slugs', () => {
  setupStore()
  const persistence = installFakePersistence()

  it('places a new entry on a free slug instead of overwriting a file that failed to parse', () => {
    setUnreadableFiles(new Map([
      [testKey('buy-groceries'), { path: 'buy-groceries.md', message: 'bad indentation, line 3' }],
    ]))

    const result = saveNode(null, 'all', {
      ...ENTRY_DEFAULT,
      title: 'Buy groceries',
      body: 'totally different note',
    })

    // Never adopts the reserved slug — the unreadable file's path stays untouched.
    expect(result).toBe(testKey('buy-groceries-2'))
    expect(useStore.getState().roots.has(testKey('buy-groceries'))).toBe(false)
    expect(useStore.getState().roots.get(testKey('buy-groceries-2'))?.body).toContain('totally different note')
    expect(persistence.writes).toEqual([testKey('buy-groceries-2')])
  })

  it('still lands a new entry on its natural slug when that slug is not reserved', () => {
    setUnreadableFiles(new Map([
      [testKey('some-other-file'), { path: 'some-other-file.md', message: 'bad indentation' }],
    ]))

    const result = saveNode(null, 'all', {
      ...ENTRY_DEFAULT,
      title: 'Buy groceries',
      body: 'note',
    })

    expect(result).toBe(testKey('buy-groceries'))
    expect(useStore.getState().roots.get(testKey('buy-groceries'))?.title).toBe('Buy groceries')
    expect(persistence.writes).toEqual([testKey('buy-groceries')])
  })
})
