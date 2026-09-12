// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import AgendaOverdueGroupRow from './AgendaOverdueGroupRow'
import { setupStore, makeOcc, TEST_VAULT } from '@/test-utils'
import { useStore } from '@/store'
import type { VaultRef } from '@/vaultRef'

setupStore()

function baseProps() {
  return {
    occ: makeOcc({ id: 'overdue-1', metadata: { fileSlug: 'note', title: 'Pay the invoice', done: false } }),
    count: 1,
    oldest: new Date(),
    onOpen: vi.fn(),
    onToggleDone: vi.fn(),
    onSwipeDelete: vi.fn(() => vi.fn()),
  }
}

/** Swipes the row containing `title` fully left, as if deleting it. */
function swipeLeft(title: string) {
  const card = screen.getByRole('button', { name: title })
  const row = card.closest('.swipe-row')
  if (!row) throw new Error(`no .swipe-row ancestor for "${title}"`)
  fireEvent.touchStart(row, { touches: [{ clientX: 300, clientY: 0 }] })
  fireEvent.touchMove(row, { touches: [{ clientX: 0, clientY: 0 }] })
  fireEvent.touchEnd(row, { changedTouches: [{ clientX: 0, clientY: 0 }] })
}

describe('AgendaOverdueGroupRow', () => {
  it('swipe-deletes the represented occurrence in a normal vault', () => {
    const props = baseProps()
    render(<AgendaOverdueGroupRow {...props} />)

    swipeLeft('Pay the invoice')

    expect(props.onSwipeDelete).toHaveBeenCalledWith(props.occ)
  })

  it('does not swipe-delete a row in a read-only (iCal) vault', () => {
    const vault: VaultRef = { id: TEST_VAULT, name: 'Family calendar', kind: 'ical', ical: { url: 'https://example.com/cal.ics' } }
    useStore.setState({ vaults: [vault] })
    const props = baseProps()
    render(<AgendaOverdueGroupRow {...props} />)

    swipeLeft('Pay the invoice')

    expect(props.onSwipeDelete).not.toHaveBeenCalled()
  })
})
