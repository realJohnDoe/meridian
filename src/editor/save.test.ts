import { describe, it, expect } from 'vitest'
import { applyScope, entryFromOccurrence } from './save'
import { makeOcc, makeSeries } from '@/test-utils'

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
    const occ = makeOcc({ metadata: { participants: [], title: 'Task', tags: [], items: [], done: false } })
    const entry = entryFromOccurrence(occ, 'single')
    expect(entry.itemType).toBe('task')
    expect(entry.tracked).toBe(true)
    expect(entry.done).toBe(false)
  })

  it('copies array-valued metadata fields instead of aliasing them', () => {
    const tags = ['work']
    const occ = makeOcc({ metadata: { participants: ['alice'], title: 'T', tags, items: [], done: true } })
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
