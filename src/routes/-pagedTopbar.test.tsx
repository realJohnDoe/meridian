// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PagedTopbar } from './-pagedTopbar'

function renderTopbar(isMobile = false) {
  const onPrev = vi.fn()
  const onNext = vi.fn()
  const openSidebar = vi.fn()
  render(
    <PagedTopbar
      isMobile={isMobile}
      openSidebar={openSidebar}
      label="June 2026"
      prevLabel="Previous month"
      nextLabel="Next month"
      onPrev={onPrev}
      onNext={onNext}
    />,
  )
  return { onPrev, onNext, openSidebar }
}

describe('PagedTopbar', () => {
  it('shows the label', () => {
    renderTopbar()
    expect(screen.getByText('June 2026')).toBeInTheDocument()
  })

  // The day and month topbars differ only in labels and targets, so the
  // caller-supplied labels are what make the two chevrons distinguishable to
  // assistive tech — they are the buttons' only accessible names.
  it('names the chevrons from the caller-supplied labels', () => {
    renderTopbar()
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeInTheDocument()
  })

  it('pages backwards', () => {
    const { onPrev, onNext } = renderTopbar()
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('pages forwards', () => {
    const { onPrev, onNext } = renderTopbar()
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onPrev).not.toHaveBeenCalled()
  })

  it('offers the menu button on mobile', () => {
    const { openSidebar } = renderTopbar(true)
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }))
    expect(openSidebar).toHaveBeenCalledTimes(1)
  })

  // Desktop keeps the sidebar permanently visible, so a menu button there
  // would be a no-op control.
  it('omits the menu button on desktop', () => {
    renderTopbar(false)
    expect(screen.queryByRole('button', { name: 'Menu' })).not.toBeInTheDocument()
  })
})
