import { describe, it, expect, vi } from 'vitest'
import { propsAreEqual } from './DaySection'
import { makeOcc } from '@/test-utils'
import type { Occurrence } from '@/types'

function baseProps(items: Occurrence[]) {
  return {
    date: new Date('2026-06-15'),
    isToday: false,
    isTomorrow: false,
    items,
    onOpen: vi.fn(),
    onToggleDone: vi.fn(),
    onSwipeDelete: vi.fn(() => vi.fn()),
  }
}

describe('DaySection.propsAreEqual', () => {
  it('treats identical props as equal', () => {
    const props = baseProps([makeOcc()])
    expect(propsAreEqual(props, { ...props })).toBe(true)
  })

  it('is unequal when isToday differs', () => {
    const prev = baseProps([makeOcc()])
    expect(propsAreEqual(prev, { ...prev, isToday: true })).toBe(false)
  })

  it('is unequal when isTomorrow differs', () => {
    const prev = baseProps([makeOcc()])
    expect(propsAreEqual(prev, { ...prev, isTomorrow: true })).toBe(false)
  })

  it('is unequal when the now reference changes, even to an equal-value Date', () => {
    const prev = { ...baseProps([makeOcc()]), now: new Date('2026-06-15T09:00:00') }
    const next = { ...prev, now: new Date('2026-06-15T09:00:00') }
    expect(propsAreEqual(prev, next)).toBe(false)
  })

  it('is equal when now is the same reference', () => {
    const now = new Date('2026-06-15T09:00:00')
    const prev = { ...baseProps([makeOcc()]), now }
    const next = { ...prev, now }
    expect(propsAreEqual(prev, next)).toBe(true)
  })

  it('is unequal when items.length differs', () => {
    const occA = makeOcc({ id: 'a' })
    const occB = makeOcc({ id: 'b' })
    expect(propsAreEqual(baseProps([occA]), baseProps([occA, occB]))).toBe(false)
  })

  it('is unequal when id differs', () => {
    const occ = makeOcc()
    expect(propsAreEqual(baseProps([occ]), baseProps([{ ...occ, id: 'other' }]))).toBe(false)
  })

  it('is unequal when ownerId differs', () => {
    const occ = makeOcc()
    expect(propsAreEqual(baseProps([occ]), baseProps([{ ...occ, ownerId: 'series-1' }]))).toBe(false)
  })

  it('is unequal when fileSlug differs', () => {
    const occ = makeOcc()
    expect(propsAreEqual(baseProps([occ]), baseProps([{ ...occ, fileSlug: 'other.md' }]))).toBe(false)
  })

  it('is unequal when date differs', () => {
    const occ = makeOcc()
    expect(propsAreEqual(baseProps([occ]), baseProps([{ ...occ, date: '2026-07-01' }]))).toBe(false)
  })

  it('is unequal when time differs', () => {
    const occ = makeOcc()
    expect(propsAreEqual(baseProps([occ]), baseProps([{ ...occ, time: '10:00' }]))).toBe(false)
  })

  it('is unequal when metadata.done differs', () => {
    const occ = makeOcc()
    const next = { ...occ, metadata: { ...occ.metadata, done: true } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('is unequal when metadata.title differs', () => {
    const occ = makeOcc()
    const next = { ...occ, metadata: { ...occ.metadata, title: 'Different' } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('is unequal when metadata.priority differs', () => {
    const occ = makeOcc()
    const next = { ...occ, metadata: { ...occ.metadata, priority: 'high' as const } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('is unequal when metadata.duration differs', () => {
    const occ = makeOcc()
    const next = { ...occ, metadata: { ...occ.metadata, duration: '30 minutes' } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('is unequal when metadata.tags differs (deep)', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Standup', tags: [], items: [] } })
    const next = { ...occ, metadata: { ...occ.metadata, tags: ['urgent'] } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('is unequal when metadata.items differs (deep)', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Standup', tags: [], items: [] } })
    const next = { ...occ, metadata: { ...occ.metadata, items: ['- [ ] step'] } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('is unequal when metadata.participants differs (deep)', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Standup', tags: [], items: [] } })
    const next = { ...occ, metadata: { ...occ.metadata, participants: ['Alice'] } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('treats equal-value tags/items/participants as equal even when the arrays are different instances', () => {
    const occ = makeOcc({ metadata: { participants: ['Alice'], title: 'Standup', tags: ['x'], items: ['y'] } })
    const next: Occurrence = {
      ...occ,
      metadata: {
        ...occ.metadata,
        participants: [...occ.metadata.participants],
        tags: [...occ.metadata.tags],
        items: [...occ.metadata.items],
      },
    }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(true)
  })
})
