// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { setupStore, seedStore, makeOcc, makeRoots } from '@/test-utils'
import { useAgendaSections } from './useAgendaSections'

setupStore()

const TODAY = new Date(2026, 5, 15)
const NOW = new Date(2026, 5, 15, 9, 0)

describe('useAgendaSections', () => {
  it('always seeds a today section, even with no occurrences', () => {
    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))

    const todaySection = result.current.sections.find(s => s.kind === 'day' && s.isToday)
    expect(todaySection).toBeDefined()
    expect(result.current.goToIndex).toBeGreaterThanOrEqual(0)
  })

  it('groups a same-day occurrence into today\'s section', () => {
    const occ = makeOcc({ id: 'today-1', date: '2026-06-15', time: '09:00' })
    seedStore([occ], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))

    const todaySection = result.current.sections.find(s => s.kind === 'day' && s.isToday)
    expect(todaySection?.items.map(o => o.id)).toEqual(['today-1'])
  })

  it('splits an undone past task into a separate overdue section, ahead of its own day section', () => {
    const overdueTask = makeOcc({
      id: 'overdue-1',
      date: '2026-06-10',
      time: null,
      metadata: { participants: [], title: 'Old task', tags: [], items: [], done: false },
    })
    const pastEvent = makeOcc({
      id: 'past-event-1',
      date: '2026-06-10',
      time: '10:00',
      fileSlug: 'other.md',
    })
    seedStore([overdueTask, pastEvent], new Map([...makeRoots('note.md'), ...makeRoots('other.md')]))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { sections, goToIndex } = result.current

    const overdueSection = sections.find(s => s.kind === 'overdue')
    expect(overdueSection?.items.map(o => o.id)).toEqual(['overdue-1'])

    const pastDaySection = sections.find(s => s.kind === 'day' && s.dateKey === '2026-06-10')
    expect(pastDaySection?.items.map(o => o.id)).toEqual(['past-event-1'])

    // goToIndex prefers the overdue section over today's when both exist.
    expect(sections[goToIndex]).toBe(overdueSection)
  })

  it('points goToIndex at today when there is no overdue section', () => {
    const occ = makeOcc({ id: 'today-1', date: '2026-06-15', time: '09:00' })
    seedStore([occ], makeRoots('note.md'))

    const { result } = renderHook(() => useAgendaSections(TODAY, NOW))
    const { sections, goToIndex } = result.current

    expect(sections.find(s => s.kind === 'overdue')).toBeUndefined()
    const todaySection = sections[goToIndex]!
    expect(todaySection.kind).toBe('day')
    expect(todaySection.kind === 'day' && todaySection.isToday).toBe(true)
  })

  it('hands back untouched day sections by reference when a task is toggled done', () => {
    const roots = makeRoots('note.md')
    const task = makeOcc({
      id: 'today-task',
      date: '2026-06-15',
      time: '09:00',
      metadata: { participants: [], title: 'Task', tags: [], items: [], done: false },
    })
    const future = makeOcc({ id: 'future-1', date: '2026-06-20', time: '09:00' })
    seedStore([task, future], roots)

    const { result, rerender } = renderHook(() => useAgendaSections(TODAY, NOW))
    const futureBefore = result.current.sections.find(s => s.kind === 'day' && s.dateKey === '2026-06-20')
    expect(futureBefore).toBeDefined()

    act(() => {
      seedStore([{ ...task, metadata: { ...task.metadata, done: true } }, future], roots)
    })
    rerender()

    // The toggled day carries the new value…
    const todayAfter = result.current.sections.find(s => s.kind === 'day' && s.isToday)
    expect(todayAfter?.items[0]!.metadata.done).toBe(true)
    // …while every other day-section is the very same object, so DaySection's
    // memo skips it instead of re-rendering the whole vault.
    expect(result.current.sections.find(s => s.kind === 'day' && s.dateKey === '2026-06-20')).toBe(futureBefore)
  })
})
