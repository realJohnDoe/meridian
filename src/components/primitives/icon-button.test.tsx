// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IconButton } from './icon-button'

// NOTE ON WHAT THESE ASSERT. `hit="expand"` grows the touch target with a
// centered 44px `::before`. jsdom computes no layout and no pseudo-elements, so
// any assertion on the *rendered* hit area would pass no matter what the
// component did — a vacuous green test. These check the class contract only,
// which is the honest limit here. Verifying the real 44px target needs a
// browser-backed runner; don't "strengthen" these into fake geometry checks.
describe('IconButton', () => {
  it('exposes the required label as the accessible name', () => {
    render(<IconButton label="Remove tag" />)
    expect(screen.getByRole('button', { name: 'Remove tag' })).toBeInTheDocument()
  })

  it('defaults to type=button so it never submits a surrounding form', () => {
    render(<IconButton label="Remove tag" />)
    expect(screen.getByRole('button', { name: 'Remove tag' })).toHaveAttribute('type', 'button')
  })

  it('still allows an explicit type', () => {
    render(<IconButton label="Save" type="submit" />)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'submit')
  })

  it('uses the ::before hit-expansion strategy by default', () => {
    render(<IconButton label="Remove tag" />)
    const btn = screen.getByRole('button', { name: 'Remove tag' })
    expect(btn.className).toContain('before:size-11')
    expect(btn.className).not.toContain('p-1.5')
  })

  it('switches to real padding under hit="pad", so clustered buttons do not overlap', () => {
    render(<IconButton label="Remove tag" hit="pad" />)
    const btn = screen.getByRole('button', { name: 'Remove tag' })
    expect(btn.className).toContain('p-1.5')
    expect(btn.className).not.toContain('before:size-11')
  })

  it('adds no visual chrome under the default plain variant', () => {
    render(<IconButton label="Remove tag" />)
    expect(screen.getByRole('button', { name: 'Remove tag' }).className).not.toContain('rounded-full')
  })

  it('applies the ghost circle chrome under variant="ghost"', () => {
    render(<IconButton label="Search" variant="ghost" />)
    const btn = screen.getByRole('button', { name: 'Search' })
    expect(btn.className).toContain('rounded-full')
    expect(btn.className).toContain('hover:bg-accent')
  })

  it('merges a caller className and forwards arbitrary button props', () => {
    const onClick = vi.fn()
    render(<IconButton label="Close" className="size-4 text-muted-foreground" onClick={onClick} data-testid="close" />)
    const btn = screen.getByTestId('close')
    expect(btn).toHaveClass('size-4', 'text-muted-foreground')

    fireEvent.click(btn)

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick while disabled', () => {
    const onClick = vi.fn()
    render(<IconButton label="Close" disabled onClick={onClick} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders its icon child', () => {
    render(<IconButton label="Close"><svg data-testid="glyph" /></IconButton>)
    expect(screen.getByTestId('glyph')).toBeInTheDocument()
  })
})
