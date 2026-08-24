// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TopbarShell } from './-topbarShell'

describe('TopbarShell', () => {
  it('renders the left and right content', () => {
    render(<TopbarShell leftHasButton left={<span>left content</span>} right={<span>right content</span>} />)
    expect(screen.getByText('left content')).toBeInTheDocument()
    expect(screen.getByText('right content')).toBeInTheDocument()
  })

  // The right edge always leads with an icon button (sync, favorite, Today, …) across every
  // view, so only the left edge's padding varies with the caller-supplied prop.
  it('tightens the left edge when it leads with a button', () => {
    const { container } = render(<TopbarShell leftHasButton left={null} right={null} />)
    expect(container.firstElementChild?.className).toContain('pl-1.75')
  })

  it('keeps the roomier left edge when it does not lead with a button', () => {
    const { container } = render(<TopbarShell leftHasButton={false} left={null} right={null} />)
    expect(container.firstElementChild?.className).toContain('pl-3.5')
  })

  it('always tightens the right edge', () => {
    const { container } = render(<TopbarShell leftHasButton={false} left={null} right={null} />)
    expect(container.firstElementChild?.className).toContain('pr-1.75')
  })
})
