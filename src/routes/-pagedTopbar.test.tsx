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
      shortLabel="Jun 2026"
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

  // On narrow screens the chevrons would crowd the label for little benefit
  // over the swipe-to-page carousel the day/month views already have.
  it('hides the chevrons on mobile', () => {
    renderTopbar(true)
    expect(screen.queryByRole('button', { name: 'Previous month' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next month' })).not.toBeInTheDocument()
  })

  // Month view passes no shortLabel because it never wants to abbreviate —
  // it should fall back to a plain label, not render a short-text node too.
  it('renders only the label when shortLabel is omitted', () => {
    render(
      <PagedTopbar
        isMobile={false}
        openSidebar={vi.fn()}
        label="August"
        prevLabel="Previous month"
        nextLabel="Next month"
        onPrev={vi.fn()}
        onNext={vi.fn()}
      />,
    )
    expect(screen.getByText('August')).toBeInTheDocument()
  })

  // The label is plain, non-interactive text until a caller opts into the
  // quick-nav disclosure by passing both expanded and onToggle.
  it('does not turn the label into a button when onToggle is omitted', () => {
    renderTopbar()
    expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument()
  })

  it('turns the label into a disclosure button when onToggle is provided', () => {
    const onToggle = vi.fn()
    render(
      <PagedTopbar
        isMobile={false}
        openSidebar={vi.fn()}
        label="June 2026"
        shortLabel="Jun 2026"
        prevLabel="Previous month"
        nextLabel="Next month"
        onPrev={vi.fn()}
        onNext={vi.fn()}
        expanded={false}
        onToggle={onToggle}
      />,
    )
    const toggle = screen.getByRole('button', { expanded: false })
    expect(toggle).toHaveAttribute('aria-controls', 'quickNavPanel')
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('reflects an open panel via aria-expanded', () => {
    render(
      <PagedTopbar
        isMobile={false}
        openSidebar={vi.fn()}
        label="June 2026"
        shortLabel="Jun 2026"
        prevLabel="Previous month"
        nextLabel="Next month"
        onPrev={vi.fn()}
        onNext={vi.fn()}
        expanded={true}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument()
  })
})
