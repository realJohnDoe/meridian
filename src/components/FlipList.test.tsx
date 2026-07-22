// @vitest-environment jsdom
import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlipList, captureFlipLeaveRect } from './FlipList'

describe('FlipList', () => {
  it('renders its children inside a wrapping container', () => {
    render(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )
    expect(screen.getByText('Row A')).toBeInTheDocument()
    expect(screen.getByText('Row B')).toBeInTheDocument()
  })

  it('re-renders cleanly when items are added, removed, and reordered', () => {
    const { rerender } = render(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    rerender(
      <FlipList items={['b', 'c']} itemAttr="data-key">
        <div data-key="b">Row B</div>
        <div data-key="c">Row C</div>
      </FlipList>,
    )

    expect(screen.queryByText('Row A')).not.toBeInTheDocument()
    expect(screen.getByText('Row B')).toBeInTheDocument()
    expect(screen.getByText('Row C')).toBeInTheDocument()
  })

  it('renders into the provided containerRef instead of creating its own', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <FlipList items={['a']} itemAttr="data-key" containerRef={ref}>
        <div data-key="a">Row A</div>
      </FlipList>,
    )
    expect(ref.current).not.toBeNull()
    expect(ref.current).toContainElement(screen.getByText('Row A'))
  })
})

describe('captureFlipLeaveRect', () => {
  it('returns null when the container ref is not attached', () => {
    const ref = createRef<HTMLDivElement>()
    const rowEl = document.createElement('div')
    expect(captureFlipLeaveRect(ref, rowEl)).toBeNull()
  })

  it('measures the row position relative to the container', () => {
    const ref = createRef<HTMLDivElement>()
    render(<div ref={ref} />)
    const rowEl = document.createElement('div')
    document.body.appendChild(rowEl)

    expect(captureFlipLeaveRect(ref, rowEl)).toEqual({ top: 0, left: 0, width: 0 })
  })
})
