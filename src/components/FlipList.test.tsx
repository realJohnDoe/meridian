// @vitest-environment jsdom
import { createRef } from 'react'
import type React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
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

// The fold's whole job when a row leaves is to keep the scroll container from
// jumping, so these cover the ordering that rests on: hold the box open before
// anything reads geometry, and put the offset back once the fold is holding it.
describe('FlipList animateHeight scroll preservation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // jsdom implements no Web Animations API, so the stub below is an added
    // property rather than a spy — restoreAllMocks doesn't know about it.
    delete (Element.prototype as Partial<Element>).animate
  })

  /** Stands in for the absent jsdom `Element.animate`. */
  function stubAnimate(onAnimate?: () => void) {
    const animate = vi.fn(() => {
      onAnimate?.()
      return { finished: new Promise(() => {/* never settles */}), cancel: vi.fn() } as unknown as Animation
    })
    Object.defineProperty(Element.prototype, 'animate', {
      value: animate, configurable: true, writable: true,
    })
    return animate
  }

  function Harness({ keys, scrollerRef, containerRef }: {
    keys: string[]
    scrollerRef: React.RefObject<HTMLDivElement | null>
    containerRef: React.RefObject<HTMLDivElement | null>
  }) {
    return (
      <div ref={scrollerRef} style={{ overflowY: 'auto' }}>
        <FlipList items={keys} itemAttr="data-key" animateHeight containerRef={containerRef}>
          {keys.map(k => <div key={k} data-key={k}>Row {k}</div>)}
        </FlipList>
      </div>
    )
  }

  /** Drives the container's measured height, since jsdom does no layout. */
  function stubHeight(el: HTMLElement, read: () => number) {
    vi.spyOn(el, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 0, left: 0, width: 0, height: read() }) as DOMRect,
    )
  }

  it('holds the box at its previous height before measuring, then restores the offset', () => {
    const scrollerRef  = createRef<HTMLDivElement>()
    const containerRef = createRef<HTMLDivElement>()
    let height = 100
    let container: HTMLElement | null = null
    const heldDuringMeasure: string[] = []

    // Stubbed from before the first render so that commit records 100px as the
    // previous height — the value the next one has to hold the box at.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (container && this === container) heldDuringMeasure.push(container.style.height)
      return ({ top: 0, left: 0, width: 0, height }) as DOMRect
    })

    const { rerender } = render(
      <Harness keys={['a', 'b']} scrollerRef={scrollerRef} containerRef={containerRef} />,
    )
    container = containerRef.current!
    const scroller = scrollerRef.current!

    // The browser clamps a bottom-pinned scroller the moment layout shrinks;
    // stand in for that at the point the fold starts, to prove the restore
    // lands after it rather than before.
    scroller.scrollTop = 164
    const animate = stubAnimate(() => { scroller.scrollTop = 124 })

    height = 60
    rerender(<Harness keys={['a']} scrollerRef={scrollerRef} containerRef={containerRef} />)

    // Measured while held at the pre-change height, so no clamp could fire.
    expect(heldDuringMeasure[0]).toBe('100px')
    // Released only to read the natural target, then re-held for the fold.
    expect(heldDuringMeasure.at(-1)).toBe('')
    // Folds from the height it was holding down to the natural new one.
    expect(animate.mock.calls[0]?.[0]).toEqual([{ height: '100px' }, { height: '60px' }])
    expect(container.style.height).toBe('100px')
    expect(scroller.scrollTop).toBe(164)
  })

  it('leaves no inline height behind when the commit changes nothing', () => {
    const scrollerRef  = createRef<HTMLDivElement>()
    const containerRef = createRef<HTMLDivElement>()

    const { rerender } = render(
      <Harness keys={['a']} scrollerRef={scrollerRef} containerRef={containerRef} />,
    )
    const container = containerRef.current!
    stubHeight(container, () => 100)

    rerender(<Harness keys={['a']} scrollerRef={scrollerRef} containerRef={containerRef} />)
    rerender(<Harness keys={['a']} scrollerRef={scrollerRef} containerRef={containerRef} />)

    expect(container.style.height).toBe('')
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
