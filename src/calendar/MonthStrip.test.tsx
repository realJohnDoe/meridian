// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MonthStrip from './MonthStrip'

function renderStrip(activeMonth = new Date(2026, 7, 1) /* Aug 2026 */) {
  const onNavigateMonth = vi.fn()
  render(<MonthStrip activeMonth={activeMonth} onNavigateMonth={onNavigateMonth} />)
  return { onNavigateMonth }
}

describe('MonthStrip', () => {
  it('renders a chip for the active month, named with its full month and year', () => {
    renderStrip()
    expect(screen.getByRole('button', { name: 'August 2026' })).toBeInTheDocument()
  })

  it('marks the active month with aria-current', () => {
    renderStrip()
    expect(screen.getByRole('button', { name: 'August 2026' })).toHaveAttribute('aria-current', 'date')
  })

  it('does not mark other months as current', () => {
    renderStrip()
    expect(screen.getByRole('button', { name: 'September 2026' })).not.toHaveAttribute('aria-current')
  })

  it('renders a year separator at January of each covered year', () => {
    renderStrip()
    const group = screen.getByRole('group', { name: 'Jump to month' })
    expect(group).toHaveTextContent('2027')
  })

  it("calls onNavigateMonth with that chip's first-of-month date when clicked", () => {
    const { onNavigateMonth } = renderStrip()
    screen.getByRole('button', { name: 'September 2026' }).click()
    expect(onNavigateMonth).toHaveBeenCalledTimes(1)
    const [d] = onNavigateMonth.mock.calls[0] as [Date]
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(8) // September, 0-indexed
    expect(d.getDate()).toBe(1)
  })

  it('centers on mount without animating', () => {
    // Spied on the prototype, not an instance: the container's own scrollTo
    // has to be observed from the very first commit, before a rendered
    // element exists to install an instance-level spy on.
    const scrollTo = vi.fn()
    // eslint-disable-next-line @typescript-eslint/unbound-method -- saved for restoration only, never called unbound
    const original = Element.prototype.scrollTo
    Element.prototype.scrollTo = scrollTo
    try {
      renderStrip()
      // Every geometry read is jsdom's default of 0, so the centering math
      // collapses to a deterministic 0 — this is exercising the real
      // formula's mount call, not just asserting "some call happened".
      expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'auto' })
    } finally {
      Element.prototype.scrollTo = original
    }
  })

  // Google Calendar's own month-jump strip doesn't auto-scroll to follow the
  // month you're currently viewing either — only the initial mount call
  // (tested above) ever positions the strip.
  it('moves the aria-current highlight, but does not scroll, when activeMonth changes after mount', () => {
    function Host({ month }: { month: Date }) {
      return <MonthStrip activeMonth={month} onNavigateMonth={vi.fn()} />
    }
    const { rerender } = render(<Host month={new Date(2026, 7, 1)} />)

    // Reinstalled after the mount-time call above, so only calls made by the
    // rerender below are observed.
    const container = screen.getByRole('group', { name: 'Jump to month' })
    const scrollTo = vi.fn()
    container.scrollTo = scrollTo

    rerender(<Host month={new Date(2026, 8, 1)} />)

    expect(screen.getByRole('button', { name: 'September 2026' })).toHaveAttribute('aria-current', 'date')
    expect(screen.getByRole('button', { name: 'August 2026' })).not.toHaveAttribute('aria-current')
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('keeps its window fixed at the month it mounted with — paging past the edge leaves nothing current', () => {
    function Host({ month }: { month: Date }) {
      return <MonthStrip activeMonth={month} onNavigateMonth={vi.fn()} />
    }
    const { rerender } = render(<Host month={new Date(2026, 7, 1)} />)
    rerender(<Host month={new Date(2030, 7, 1)} />) // 48 months forward — past MONTHS_FORWARD (36)
    expect(screen.queryByRole('button', { current: 'date' })).not.toBeInTheDocument()
  })
})
