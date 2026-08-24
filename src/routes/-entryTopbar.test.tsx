// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopbarSlotContext } from './-topbarSlot'
import { EntryTopbar } from './-entryTopbar'

// A collaborator, not the subject: SyncButton drags in the whole sync/store stack.
vi.mock('@/components', () => ({ SyncButton: () => <div data-testid="sync-button" /> }))

interface Opts {
  isFavorited?: boolean
  favoritable?: boolean
  slot?: HTMLElement | null
}

function renderTopbar({ isFavorited = false, favoritable = true, slot }: Opts = {}) {
  const onToggleFavorite = vi.fn()
  const onDelete = vi.fn()
  const onBack = vi.fn()
  const slotEl = slot === undefined ? document.createElement('div') : slot
  if (slotEl) document.body.appendChild(slotEl)
  const view = render(
    <TopbarSlotContext value={slotEl as HTMLDivElement | null}>
      <EntryTopbar
        isFavorited={isFavorited}
        onToggleFavorite={favoritable ? onToggleFavorite : null}
        onDelete={onDelete}
        onBack={onBack}
      />
    </TopbarSlotContext>,
  )
  return { ...view, slotEl, onToggleFavorite, onDelete, onBack }
}

describe('EntryTopbar', () => {
  // _app.tsx sets the slot with a callback ref, so the first render of an
  // entry route happens before the target exists. Rendering the portal then
  // would throw on a null container.
  it('renders nothing until the topbar slot exists', () => {
    const { container } = renderTopbar({ slot: null })
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('portals its controls into the slot rather than rendering in place', () => {
    const { container, slotEl } = renderTopbar()
    expect(container).toBeEmptyDOMElement()
    expect(slotEl!.querySelector('[data-testid="sync-button"]')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it('calls onBack from the back button', () => {
    const { onBack } = renderTopbar()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete from the delete button', () => {
    const { onDelete } = renderTopbar()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  // view-only (an iCal subscription): no source to delete from.
  it('hides the delete button when hideDelete is set', () => {
    const slotEl = document.createElement('div')
    document.body.appendChild(slotEl)
    render(
      <TopbarSlotContext value={slotEl}>
        <EntryTopbar isFavorited={false} onToggleFavorite={vi.fn()} onBack={vi.fn()} hideDelete />
      </TopbarSlotContext>,
    )
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
  })
})

describe('EntryTopbar — favorite toggle', () => {
  it('offers to add when the entry is not favorited', () => {
    const { onToggleFavorite } = renderTopbar({ isFavorited: false })
    const btn = screen.getByRole('button', { name: 'Add to favorites' })
    expect(btn).toBeEnabled()

    fireEvent.click(btn)

    expect(onToggleFavorite).toHaveBeenCalledTimes(1)
  })

  it('offers to remove, and fills the heart, when the entry is favorited', () => {
    renderTopbar({ isFavorited: true })
    const btn = screen.getByRole('button', { name: 'Remove from favorites' })
    expect(btn.querySelector('svg')?.getAttribute('class')).toContain('fill-current')
  })

  it('leaves the heart unfilled when not favorited', () => {
    renderTopbar({ isFavorited: false })
    const btn = screen.getByRole('button', { name: 'Add to favorites' })
    expect(btn.querySelector('svg')?.getAttribute('class')).not.toContain('fill-current')
  })

  // A brand-new entry has no title yet, so there is no slug for a favorite to
  // attach to — the route passes null and the control must be inert.
  it('disables the control when there is nothing to favorite yet', () => {
    const { onToggleFavorite } = renderTopbar({ favoritable: false })
    const btn = screen.getByRole('button', { name: 'Add to favorites' })
    expect(btn).toBeDisabled()

    fireEvent.click(btn)

    expect(onToggleFavorite).not.toHaveBeenCalled()
  })
})

describe('EntryTopbar — edge padding', () => {
  // The back button leads the left edge on every screen size now, so both
  // edges always get the tighter icon-button padding.
  it('tightens the left edge, which leads with the back button', () => {
    const { slotEl } = renderTopbar()
    expect(slotEl!.firstElementChild?.className).toContain('pl-1.75')
  })

  it('always tightens the right edge, which leads with an icon button in both layouts', () => {
    const { slotEl } = renderTopbar()
    expect(slotEl!.firstElementChild?.className).toContain('pr-1.75')
  })
})
