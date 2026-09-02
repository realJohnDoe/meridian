// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

  it('gives the active month a primary tint ringed in primary when it is not the current real month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10)) // September 2026 — not the active August chip
    try {
      renderStrip()
      expect(screen.getByRole('button', { name: 'August 2026' })).toHaveClass('bg-primary/15', 'ring-2', 'ring-primary')
      expect(screen.getByRole('button', { name: 'August 2026' })).not.toHaveClass('bg-primary')
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives the current real month the solid primary fill even when it is not the active chip', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10)) // September 2026, while August is active
    try {
      renderStrip()
      expect(screen.getByRole('button', { name: 'September 2026' })).toHaveClass('bg-primary')
      expect(screen.getByRole('button', { name: 'September 2026' })).not.toHaveClass('bg-primary/15')
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives the active month the solid primary fill, not the tint, when it is also the current real month', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 10)) // August 2026 — matches the active chip
    try {
      renderStrip()
      expect(screen.getByRole('button', { name: 'August 2026' })).toHaveClass('bg-primary')
      expect(screen.getByRole('button', { name: 'August 2026' })).not.toHaveClass('bg-primary/15')
      expect(screen.getByRole('button', { name: 'August 2026' })).not.toHaveClass('ring-primary')
    } finally {
      vi.useRealTimers()
    }
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

  // Doesn't recenter on every page the way the mount effect does — only
  // nudges the strip when paging actually carries the active chip out of
  // view (see the two tests below). With jsdom's default all-zero geometry
  // the chip always reads as already visible, so this exercises the "still
  // in view" branch of that check.
  it('moves the aria-current highlight, but does not scroll, when the newly active month is still in view', () => {
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

  describe('nudging the active chip back into view', () => {
    // Gives every chip a uniform 56px slot and the strip a 300px viewport, so
    // the geometry math in the component (which reads real offsetLeft/
    // offsetWidth/clientWidth/scrollWidth) has non-zero numbers to work with
    // — jsdom itself never lays anything out. scrollLeft is backed by a
    // WeakMap and scrollTo writes through it, so the mount-time centering
    // call actually moves the tracked viewport before each test's rerender.
    const CHIP_W = 56
    const CLIENT_W = 300
    const scrollLefts = new WeakMap<Element, number>()
    let offsetLeftDescriptor: PropertyDescriptor | undefined
    let offsetWidthDescriptor: PropertyDescriptor | undefined
    let clientWidthDescriptor: PropertyDescriptor | undefined
    let scrollWidthDescriptor: PropertyDescriptor | undefined
    let scrollLeftDescriptor: PropertyDescriptor | undefined
    let scrollToDescriptor: PropertyDescriptor | undefined

    const isGroup = (el: Element) => el.getAttribute('role') === 'group'
    const chipIndex = (el: Element) => Array.from(document.querySelectorAll('[role="group"] button')).indexOf(el)

    beforeEach(() => {
      offsetLeftDescriptor  = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft')
      offsetWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
      clientWidthDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
      scrollWidthDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth')
      scrollLeftDescriptor  = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollLeft')
      scrollToDescriptor    = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo')

      Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
        configurable: true,
        get(this: HTMLElement) { return chipIndex(this) * CHIP_W },
      })
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get(this: HTMLElement) { return this.tagName === 'BUTTON' ? CHIP_W : 0 },
      })
      Object.defineProperty(Element.prototype, 'clientWidth', {
        configurable: true,
        get(this: Element) { return isGroup(this) ? CLIENT_W : 0 },
      })
      Object.defineProperty(Element.prototype, 'scrollWidth', {
        configurable: true,
        get(this: Element) { return isGroup(this) ? this.querySelectorAll('button').length * CHIP_W : 0 },
      })
      Object.defineProperty(Element.prototype, 'scrollLeft', {
        configurable: true,
        get(this: Element) { return scrollLefts.get(this) ?? 0 },
        set(this: Element, v: number) { scrollLefts.set(this, v) },
      })
      Object.defineProperty(Element.prototype, 'scrollTo', {
        configurable: true, writable: true,
        value(this: Element, opts?: { left?: number }) {
          if (typeof opts?.left === 'number') this.scrollLeft = opts.left
        },
      })
    })

    afterEach(() => {
      const restore = (proto: object, name: string, d: PropertyDescriptor | undefined) => {
        if (d) Object.defineProperty(proto, name, d)
        else delete (proto as Record<string, unknown>)[name]
      }
      restore(HTMLElement.prototype, 'offsetLeft', offsetLeftDescriptor)
      restore(HTMLElement.prototype, 'offsetWidth', offsetWidthDescriptor)
      restore(Element.prototype, 'clientWidth', clientWidthDescriptor)
      restore(Element.prototype, 'scrollWidth', scrollWidthDescriptor)
      restore(Element.prototype, 'scrollLeft', scrollLeftDescriptor)
      restore(Element.prototype, 'scrollTo', scrollToDescriptor)
    })

    function Host({ month }: { month: Date }) {
      return <MonthStrip activeMonth={month} onNavigateMonth={vi.fn()} />
    }

    it('scrolls forward just enough to land the newly active month as the last chip', () => {
      // Anchor month (Aug 2026) sits at window index 24 (MONTHS_BACK); the
      // mount effect centers it, leaving the viewport at [1222, 1522].
      const { rerender } = render(<Host month={new Date(2026, 7, 1)} />)
      const container = screen.getByRole('group', { name: 'Jump to month' })
      const scrollTo = vi.fn()
      container.scrollTo = scrollTo

      // 16 months forward lands at index 40 — chip spans [2240, 2296],
      // entirely past the [1222, 1522] viewport.
      rerender(<Host month={new Date(2027, 11, 1)} />)

      expect(scrollTo).toHaveBeenCalledWith({ left: 1996, behavior: 'smooth' })
      expect(screen.getByRole('button', { name: 'December 2027' })).toHaveAttribute('aria-current', 'date')
    })

    it('scrolls backward just enough to land the newly active month as the first chip', () => {
      // Whatever month mounts the strip is always the anchor, and the anchor
      // always lands at window index 24 (MONTHS_BACK) — so mounting on Dec
      // 2027 instead of Aug 2026 doesn't change the post-mount viewport:
      // centering still leaves it at [1222, 1522].
      const { rerender } = render(<Host month={new Date(2027, 11, 1)} />)
      const container = screen.getByRole('group', { name: 'Jump to month' })
      const scrollTo = vi.fn()
      container.scrollTo = scrollTo

      // April 2026 is 20 months before the Dec 2027 anchor, landing at index
      // 4 — chip spans [224, 280], entirely before the [1222, 1522] viewport.
      rerender(<Host month={new Date(2026, 3, 1)} />)

      expect(scrollTo).toHaveBeenCalledWith({ left: 224, behavior: 'smooth' })
      expect(screen.getByRole('button', { name: 'April 2026' })).toHaveAttribute('aria-current', 'date')
    })
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
