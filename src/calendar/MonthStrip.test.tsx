// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import MonthStrip from './MonthStrip'

// jsdom has no layout, so offsetLeft/offsetWidth/clientWidth/scrollWidth all
// read 0 by default — mirrors the scrollTop-shadowing pattern in
// TimeWheels.test.tsx (setScrollTop). Values are set directly on the element
// instance, which is safe here because React reuses the same DOM node for a
// given month's chip across rerenders (each is keyed by its "YYYY-MM" key).
function defineGeometry(el: HTMLElement, props: Record<string, number>) {
  for (const [k, v] of Object.entries(props)) {
    Object.defineProperty(el, k, { value: v, writable: true, configurable: true })
  }
}

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

  it('recenters smoothly on the new active chip when activeMonth changes after mount', () => {
    function Host({ month }: { month: Date }) {
      return <MonthStrip activeMonth={month} onNavigateMonth={vi.fn()} />
    }
    const { rerender } = render(<Host month={new Date(2026, 7, 1)} />)

    const container = screen.getByRole('group', { name: 'Jump to month' })
    defineGeometry(container, { clientWidth: 300, scrollWidth: 4000 })
    // September's chip is already in the strip (just not yet active) — same
    // DOM node React will keep mounted once it becomes the active month.
    const septChip = screen.getByRole('button', { name: 'September 2026' })
    defineGeometry(septChip, { offsetLeft: 1240, offsetWidth: 60 })

    const scrollTo = vi.fn()
    container.scrollTo = scrollTo

    rerender(<Host month={new Date(2026, 8, 1)} />)

    // 1240 - 300/2 + 60/2 = 1120, within [0, 4000-300].
    expect(scrollTo).toHaveBeenCalledWith({ left: 1120, behavior: 'smooth' })
  })
})
