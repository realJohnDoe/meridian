// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import OccurrenceList from './OccurrenceList'
import { setupStore, makeOcc } from '@/test-utils'
import type { Occurrence } from '@/types'

setupStore()

function baseProps(occs: Occurrence[]) {
  return {
    occs,
    onOpen: vi.fn(),
    onToggleDone: vi.fn(),
    onSwipeDelete: vi.fn(() => vi.fn()),
  }
}

describe('OccurrenceList', () => {
  it('shows active items immediately', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Open task', tags: [], items: [], done: false } })
    render(<OccurrenceList {...baseProps([occ])} />)

    expect(screen.getByText('Open task')).toBeInTheDocument()
  })

  it('omits the Done section entirely when there are no done items', () => {
    const occ = makeOcc({ metadata: { participants: [], title: 'Open task', tags: [], items: [], done: false } })
    render(<OccurrenceList {...baseProps([occ])} />)

    expect(screen.queryByText(/^Done ·/)).not.toBeInTheDocument()
  })

  it('hides done items behind a collapsed Done section, revealed on click', () => {
    const open = makeOcc({ id: 'a', metadata: { participants: [], title: 'Open task', tags: [], items: [], done: false } })
    const done = makeOcc({ id: 'b', metadata: { participants: [], title: 'Finished task', tags: [], items: [], done: true } })
    render(<OccurrenceList {...baseProps([open, done])} />)

    expect(screen.getByText('Open task')).toBeInTheDocument()
    expect(screen.queryByText('Finished task')).not.toBeInTheDocument()
    expect(screen.getByText('Done · 1')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Done · 1'))

    expect(screen.getByText('Finished task')).toBeInTheDocument()
  })

  it('calls onToggleDone when a row checkbox is clicked', () => {
    const onToggleDone = vi.fn()
    const occ = makeOcc({ metadata: { participants: [], title: 'Open task', tags: [], items: [], done: false } })
    render(<OccurrenceList {...baseProps([occ])} onToggleDone={onToggleDone} />)

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onToggleDone).toHaveBeenCalledWith(occ)
  })
})
