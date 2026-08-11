// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ContinuationChevron } from './ContinuationChevron'

const svgOf = (container: HTMLElement) => container.querySelector('svg')!

describe('ContinuationChevron', () => {
  it('points right for side="right"', () => {
    const svg = svgOf(render(<ContinuationChevron side="right" />).container)
    expect(svg.getAttribute('class')).toContain('chevron-right')
    expect(svg.getAttribute('class')).not.toContain('chevron-left')
  })

  it('points left for side="left"', () => {
    const svg = svgOf(render(<ContinuationChevron side="left" />).container)
    expect(svg.getAttribute('class')).toContain('chevron-left')
    expect(svg.getAttribute('class')).not.toContain('chevron-right')
  })

  it('is decorative — hidden from assistive tech', () => {
    expect(svgOf(render(<ContinuationChevron side="right" />).container)).toHaveAttribute('aria-hidden')
  })

  // The chevron shares a flex row with the title (see OccurrencePill) rather
  // than floating over it on an absolute inset, which is what keeps the two
  // from overlapping. Both halves matter: no positioning of its own, and
  // shrink-0 so a long title can't squeeze it away — the pill's
  // non-interactive form is a plain div, with none of shadcn Button's
  // `[&_svg]:shrink-0` to fall back on.
  it('lays out in flow, at a size a long title cannot squeeze', () => {
    const svg = svgOf(render(<ContinuationChevron side="right" />).container)
    expect(svg.getAttribute('class')).toContain('shrink-0')
    expect(svg.getAttribute('class')).not.toContain('absolute')
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
    expect(svg.getAttribute('class')).toContain('shrink-0')
  })
})
