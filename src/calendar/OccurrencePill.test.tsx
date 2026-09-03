// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { OccurrencePill } from './OccurrencePill'

/** The pill root — the element carrying the flex row, whichever form it took. */
function pillOf(container: HTMLElement): HTMLElement {
  return container.firstElementChild as HTMLElement
}

/** Direct children of the pill, in DOM order, as tag names. */
function rowChildren(container: HTMLElement): string[] {
  return [...pillOf(container).children].map(el => el.tagName.toLowerCase())
}

describe('OccurrencePill', () => {
  it('lays the chevrons out in the same flex row as the title', () => {
    const { container } = render(
      <OccurrencePill tone="event" title="Conference" continuesLeft continuesRight />,
    )
    const cls = pillOf(container).getAttribute('class')!
    expect(cls).toContain('flex')
    expect(cls).toContain('items-center')
    // gap-1, not the gap-2 shadcn Button contributes to the interactive form.
    expect(cls).toContain('gap-1')
    expect(rowChildren(container)).toEqual(['svg', 'span', 'svg'])
  })

  // The chevrons used to be absolutely positioned, with the pill reserving
  // pl-4/pr-4 so the title wouldn't run under them. In a flex row they take
  // their own width, so any leftover reserve would be double-counted padding.
  it('reserves no padding for the chevrons', () => {
    const { container } = render(
      <OccurrencePill tone="event" title="Conference" continuesLeft continuesRight />,
    )
    const cls = pillOf(container).getAttribute('class')!
    expect(cls).not.toContain('pl-4')
    expect(cls).not.toContain('pr-4')
    expect(cls).not.toContain('relative')
  })

  it('puts a left-continuation chevron before the title and a right one after', () => {
    const { container: left } = render(<OccurrencePill tone="note" title="Trip" continuesLeft />)
    expect(rowChildren(left)).toEqual(['svg', 'span'])

    const { container: right } = render(<OccurrencePill tone="note" title="Trip" continuesRight />)
    expect(rowChildren(right)).toEqual(['span', 'svg'])
  })

  it('renders no chevron when the occurrence is fully contained', () => {
    const { container } = render(<OccurrencePill tone="note" title="Trip" />)
    expect(rowChildren(container)).toEqual(['span'])
  })

  it('hides the chevrons below sm: only when the caller asks', () => {
    const { container: hidden } = render(
      <OccurrencePill tone="note" title="Trip" continuesLeft chevronHiddenOnMobile />,
    )
    expect(hidden.querySelector('svg')!.getAttribute('class')).toContain('hidden')

    const { container: shown } = render(<OccurrencePill tone="note" title="Trip" continuesLeft />)
    expect(shown.querySelector('svg')!.getAttribute('class')).not.toContain('hidden')
  })

  it('is an interactive button only when given an onClick', () => {
    const { container } = render(<OccurrencePill tone="note" title="Trip" onClick={() => {}} />)
    expect(screen.getByRole('button', { name: 'Trip' })).toBe(pillOf(container))

    const { container: plain } = render(<OccurrencePill tone="note" title="Trip" />)
    expect(pillOf(plain).tagName.toLowerCase()).toBe('div')
  })

  it('keeps the title truncating rather than growing the row', () => {
    const { container } = render(<OccurrencePill tone="note" title="A very long title" continuesRight />)
    const span = container.querySelector('span')!
    expect(span.getAttribute('class')).toContain('truncate')
    expect(span.getAttribute('class')).toContain('min-w-0')
  })
})
