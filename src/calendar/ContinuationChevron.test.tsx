// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ContinuationChevron, CONTINUES_PADDING, CONTINUES_PADDING_ALWAYS } from './ContinuationChevron'

const svgOf = (container: HTMLElement) => container.querySelector('svg')!

describe('ContinuationChevron', () => {
  it('points right and sits at the right edge for side="right"', () => {
    const { container } = render(<ContinuationChevron side="right" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('class')).toContain('chevron-right')
    expect(svg.getAttribute('class')).toContain('right-0.5')
    expect(svg.getAttribute('class')).not.toContain('left-0.5')
  })

  it('points left and sits at the left edge for side="left"', () => {
    const { container } = render(<ContinuationChevron side="left" />)
    const svg = svgOf(container)
    expect(svg.getAttribute('class')).toContain('chevron-left')
    expect(svg.getAttribute('class')).toContain('left-0.5')
    expect(svg.getAttribute('class')).not.toContain('right-0.5')
  })

  it('is decorative — hidden from assistive tech', () => {
    expect(svgOf(render(<ContinuationChevron side="right" />).container)).toHaveAttribute('aria-hidden')
  })

  // The size comes from an inline style, not the `size` prop, specifically so
  // it survives shadcn Button's `[&_svg]:size-4` descendant rule — a
  // higher-specificity selector that silently rendered this at 16px. If this
  // ever regresses to a class or the `size` prop, DayView's chevron grows.
  it('pins its 10px size inline so a parent Button cannot override it', () => {
    const svg = svgOf(render(<ContinuationChevron side="right" />).container)
    expect(svg.style.width).toBe('10px')
    expect(svg.style.height).toBe('10px')
  })

  it('merges a caller className, so callers can hide it at narrow widths', () => {
    const svg = svgOf(render(<ContinuationChevron side="right" className="hidden sm:block" />).container)
    expect(svg.getAttribute('class')).toContain('hidden')
    expect(svg.getAttribute('class')).toContain('sm:block')
    expect(svg.getAttribute('class')).toContain('right-0.5')
  })

  // These constants exist so MonthView bars and DayView's all-day pill reserve
  // the same room for the chevron. A side must reserve padding on its own side.
  it('reserves padding on the matching side', () => {
    expect(CONTINUES_PADDING.left).toContain('pl-')
    expect(CONTINUES_PADDING.right).toContain('pr-')
    expect(CONTINUES_PADDING_ALWAYS.left).toContain('pl-')
    expect(CONTINUES_PADDING_ALWAYS.right).toContain('pr-')
  })

  it('differs from the responsive variant only by the sm: breakpoint prefix', () => {
    expect(CONTINUES_PADDING.left).toBe(`sm:${CONTINUES_PADDING_ALWAYS.left}`)
    expect(CONTINUES_PADDING.right).toBe(`sm:${CONTINUES_PADDING_ALWAYS.right}`)
  })
})
