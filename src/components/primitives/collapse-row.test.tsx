// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { CollapseRow } from './collapse-row'
import { MOTION_MS } from './motion'

afterEach(() => { vi.useRealTimers() })

/** jsdom parses inline styles, so the collapse's own state is readable here. */
function outerOf(text: string): HTMLElement {
  // The row renders outer > inner > children.
  return screen.getByText(text).parentElement!.parentElement!
}

describe('CollapseRow', () => {
  it('sizes the grid row to its content until collapsed, then to nothing', () => {
    const { rerender } = render(<CollapseRow collapsed={false}><span>Row</span></CollapseRow>)
    expect(outerOf('Row').style.gridTemplateRows).toBe('1fr')

    rerender(<CollapseRow collapsed><span>Row</span></CollapseRow>)
    expect(outerOf('Row').style.gridTemplateRows).toBe('0fr')
  })

  // `0fr` sizes the grid row; only a child that may be smaller than its content
  // is actually clipped by it. Collapsing a single box leaves content sticking out.
  it('clips its content in a child that may be smaller than it', () => {
    render(<CollapseRow collapsed><span>Row</span></CollapseRow>)
    const inner = screen.getByText('Row').parentElement!
    expect(inner.style.overflow).toBe('hidden')
    expect(inner.style.minHeight).toBe('0px')
  })

  // A flex/grid parent holds a gap open around a row of height 0, so the row
  // would finish its collapse one gap short of gone and jump it on unmount.
  it('cancels the parent list gap once collapsed, and only then', () => {
    const { rerender } = render(
      <CollapseRow collapsed={false} gap="0.375rem"><span>Row</span></CollapseRow>,
    )
    expect(outerOf('Row').style.marginBottom).toBe('0px')

    rerender(<CollapseRow collapsed gap="0.375rem"><span>Row</span></CollapseRow>)
    expect(outerOf('Row').style.marginBottom).toBe('-0.375rem')
  })

  it('leaves the margin alone when the parent has no gap', () => {
    render(<CollapseRow collapsed><span>Row</span></CollapseRow>)
    expect(outerOf('Row').style.marginBottom).toBe('0px')
  })

  it('renders as an li when the row is a direct child of a list', () => {
    render(<CollapseRow as="li" collapsed={false}><span>Row</span></CollapseRow>)
    expect(outerOf('Row').tagName).toBe('LI')
  })

  // The row still holds real buttons while it collapses, so it has to leave the
  // tab order as well as the accessibility tree — `inert` does both, where
  // `aria-hidden` alone would hide a still-focusable subtree.
  it('makes a collapsing row inert, and only while it is collapsing', () => {
    const { rerender } = render(<CollapseRow collapsed={false}><span>Row</span></CollapseRow>)
    expect(outerOf('Row').hasAttribute('inert')).toBe(false)

    rerender(<CollapseRow collapsed><span>Row</span></CollapseRow>)
    expect(outerOf('Row').hasAttribute('inert')).toBe(true)
  })

  it('reports the collapse as finished when its own transition ends', () => {
    const onCollapsed = vi.fn()
    render(<CollapseRow collapsed onCollapsed={onCollapsed}><span>Row</span></CollapseRow>)

    act(() => {
      const e = new Event('transitionend', { bubbles: true }) as TransitionEvent
      Object.defineProperty(e, 'propertyName', { value: 'grid-template-rows' })
      outerOf('Row').dispatchEvent(e)
    })
    expect(onCollapsed).toHaveBeenCalledTimes(1)
  })

  // transitionend bubbles, so a transition on anything rendered inside the row
  // would otherwise unmount it early, mid-collapse.
  it('ignores a transition that ended on something inside the row', () => {
    const onCollapsed = vi.fn()
    render(<CollapseRow collapsed onCollapsed={onCollapsed}><span>Row</span></CollapseRow>)

    act(() => {
      const e = new Event('transitionend', { bubbles: true }) as TransitionEvent
      Object.defineProperty(e, 'propertyName', { value: 'opacity' })
      screen.getByText('Row').dispatchEvent(e)
    })
    expect(onCollapsed).not.toHaveBeenCalled()
  })

  // A transition that never runs never ends — a row collapsed inside a hidden
  // subtree, or under a UA that refuses the interpolation, would strand itself.
  it('reports the collapse as finished even if the transition never fires', () => {
    vi.useFakeTimers()
    const onCollapsed = vi.fn()
    render(<CollapseRow collapsed onCollapsed={onCollapsed}><span>Row</span></CollapseRow>)

    expect(onCollapsed).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(MOTION_MS + 200) })
    expect(onCollapsed).toHaveBeenCalledTimes(1)
  })

  it('reports the collapse as finished exactly once', () => {
    vi.useFakeTimers()
    const onCollapsed = vi.fn()
    render(<CollapseRow collapsed onCollapsed={onCollapsed}><span>Row</span></CollapseRow>)

    act(() => {
      const e = new Event('transitionend', { bubbles: true }) as TransitionEvent
      Object.defineProperty(e, 'propertyName', { value: 'grid-template-rows' })
      outerOf('Row').dispatchEvent(e)
    })
    act(() => { vi.advanceTimersByTime(MOTION_MS + 200) })
    expect(onCollapsed).toHaveBeenCalledTimes(1)
  })

  // An inline `onCollapsed` is a new function every render; depending on it
  // would restart the safety timer on every unrelated re-render, so a list that
  // re-renders steadily would never release the row.
  it('does not restart the safety timer when an unrelated re-render lands', () => {
    vi.useFakeTimers()
    const onCollapsed = vi.fn()
    const { rerender } = render(
      <CollapseRow collapsed onCollapsed={() => { onCollapsed() }}><span>Row</span></CollapseRow>,
    )

    act(() => { vi.advanceTimersByTime(MOTION_MS) })
    rerender(<CollapseRow collapsed onCollapsed={() => { onCollapsed() }}><span>Row</span></CollapseRow>)
    act(() => { vi.advanceTimersByTime(200) })

    expect(onCollapsed).toHaveBeenCalledTimes(1)
  })
})
