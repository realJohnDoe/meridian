// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OverdueSection, { propsAreEqual } from './OverdueSection'
import { setupStore, makeOcc } from '@/test-utils'
import type { Occurrence } from '@/types'

setupStore()

function baseProps(items: Occurrence[]) {
  return {
    items,
    onOpen: vi.fn(),
    onToggleDone: vi.fn(),
    onSwipeDelete: vi.fn(() => vi.fn()),
  }
}

describe('OverdueSection.propsAreEqual', () => {
  it('treats identical props as equal', () => {
    const props = baseProps([makeOcc()])
    expect(propsAreEqual(props, { ...props })).toBe(true)
  })

  it('is equal when only the callback props differ (new references)', () => {
    const prev = baseProps([makeOcc()])
    const next = baseProps(prev.items)
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

  it('is unequal when date differs', () => {
    const occ = makeOcc()
    expect(propsAreEqual(baseProps([occ]), baseProps([{ ...occ, date: '2026-07-01' }]))).toBe(false)
  })

  it('is unequal when metadata.jsTime differs', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Standup', tags: [], items: [], jsTime: new Date('2026-06-15T09:00:00') } })
    const next = { ...occ, metadata: { ...occ.metadata, jsTime: new Date('2026-06-16T09:00:00') } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(false)
  })

  it('is unequal when metadata.done differs', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Standup', tags: [], items: [], done: false } })
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

  it('is equal when only metadata.participants differs — not part of this comparator', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Standup', tags: [], items: [] } })
    const next = { ...occ, metadata: { ...occ.metadata, participants: ['Alice'] } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(true)
  })

  it('is equal when only metadata.tags differs — not part of this comparator', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Standup', tags: [], items: [] } })
    const next = { ...occ, metadata: { ...occ.metadata, tags: ['urgent'] } }
    expect(propsAreEqual(baseProps([occ]), baseProps([next]))).toBe(true)
  })
})

describe('OverdueSection render', () => {
  it('shows the Overdue header and each item title', () => {
    const a = makeOcc({ id: 'a', metadata: { participants: [], title: 'Pay invoice', tags: [], items: [], done: false } })
    const b = makeOcc({ id: 'b', metadata: { participants: [], title: 'File taxes', tags: [], items: [], done: false } })
    render(<OverdueSection {...baseProps([a, b])} />)

    expect(screen.getByText('Overdue')).toBeInTheDocument()
    expect(screen.getByText('Pay invoice')).toBeInTheDocument()
    expect(screen.getByText('File taxes')).toBeInTheDocument()
  })

  it('calls onOpen when a row is clicked', () => {
    const onOpen = vi.fn()
    const occ = makeOcc({ metadata: { participants: [], title: 'Pay invoice', tags: [], items: [], done: false } })
    render(<OverdueSection {...baseProps([occ])} onOpen={onOpen} />)

    fireEvent.click(screen.getByRole('button', { name: 'Pay invoice' }))

    expect(onOpen).toHaveBeenCalledWith(occ)
  })
})
