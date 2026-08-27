// @vitest-environment jsdom
import { createRef } from 'react'
import type React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlipList, captureFlipLeaveRect } from './FlipList'

describe('FlipList', () => {
  // jsdom implements no Web Animations API. These tests only care that a
  // re-render doesn't throw, not what the (unmeasurable, in jsdom) animation
  // looks like — a harmless stub is enough; the animation content itself is
  // covered by the more targeted describe blocks below.
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'animate', {
      value: () => ({ finished: new Promise(() => {/* never settles */}), cancel: vi.fn() }) as unknown as Animation,
      configurable: true,
      writable: true,
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (Element.prototype as Partial<Element>).animate
  })

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

  /**
   * Stands in for the absent jsdom `Element.animate`, collecting the keyframes
   * it was handed so a caller can assert on what the fold asked for.
   */
  function stubAnimate(onAnimate?: () => void) {
    const keyframeCalls: Keyframe[][] = []
    Object.defineProperty(Element.prototype, 'animate', {
      value: (keyframes: Keyframe[]) => {
        keyframeCalls.push(keyframes)
        onAnimate?.()
        return { finished: new Promise(() => {/* never settles */}), cancel: vi.fn() } as unknown as Animation
      },
      configurable: true,
      writable: true,
    })
    return keyframeCalls
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

  /**
   * jsdom does no layout, so every element reports scrollHeight === clientHeight
   * === 0 — i.e. "declares overflow but has nothing to scroll", which is exactly
   * the case FlipList must now walk past. Give a scroller real overflow so it
   * is the element the hold is expected to pin.
   */
  function stubOverflow(el: HTMLElement, { scrollHeight = 500, clientHeight = 200 } = {}) {
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
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
    stubOverflow(scroller)

    // The browser clamps a bottom-pinned scroller the moment layout shrinks;
    // stand in for that at the point the fold starts, to prove the restore
    // lands after it rather than before.
    scroller.scrollTop = 164
    const keyframeCalls = stubAnimate(() => { scroller.scrollTop = 124 })

    height = 60
    rerender(<Harness keys={['a']} scrollerRef={scrollerRef} containerRef={containerRef} />)

    // Measured while held at the pre-change height, so no clamp could fire.
    expect(heldDuringMeasure[0]).toBe('100px')
    // Released only to read the natural target, then re-held for the fold.
    expect(heldDuringMeasure.at(-1)).toBe('')
    // Folds from the height it was holding down to the natural new one.
    const fold = keyframeCalls.find(frames => frames[0] && 'height' in frames[0])
    expect(fold).toEqual([{ height: '100px' }, { height: '60px' }])
    expect(container.style.height).toBe('100px')
    expect(scroller.scrollTop).toBe(164)
  })

  // The entry routes put a `.flex-1.overflow-y-auto` between the Items list and
  // the document, but never cap the app column's height — so that div sits at
  // scrollHeight === clientHeight and the *document* is what scrolls. Pinning
  // the nearest element that merely declares overflow wrote the offset to that
  // inert div, leaving the real scroller to clamp during the one un-held layout
  // that reads the natural height: the instant jump the hold exists to prevent.
  it('pins the ancestor that actually scrolls, not the nearest one declaring overflow', () => {
    const outerRef     = createRef<HTMLDivElement>()
    const inertRef     = createRef<HTMLDivElement>()
    const containerRef = createRef<HTMLDivElement>()
    let height = 100
    let container: HTMLElement | null = null

    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      () => ({ top: 0, left: 0, width: 0, height }) as DOMRect,
    )

    function Nested({ keys }: { keys: string[] }) {
      return (
        <div ref={outerRef} style={{ overflowY: 'auto' }}>
          <div ref={inertRef} style={{ overflowY: 'auto' }}>
            <FlipList items={keys} itemAttr="data-key" animateHeight containerRef={containerRef}>
              {keys.map(k => <div key={k} data-key={k}>Row {k}</div>)}
            </FlipList>
          </div>
        </div>
      )
    }

    const { rerender } = render(<Nested keys={['a', 'b']} />)
    container = containerRef.current!
    const outer = outerRef.current!
    const inert = inertRef.current!

    // The inner pane declares overflow but has nothing to scroll; the outer one
    // is the real scroller, sitting at its bottom edge.
    stubOverflow(inert, { scrollHeight: 200, clientHeight: 200 })
    stubOverflow(outer, { scrollHeight: 500, clientHeight: 200 })
    outer.scrollTop = 300

    // Stand in for the browser clamping the real scroller during the un-held
    // measuring layout — the restore has to undo exactly this.
    stubAnimate(() => { outer.scrollTop = 240 })

    height = 60
    rerender(<Nested keys={['a']} />)

    expect(outer.scrollTop).toBe(300)
    // The inert pane is never written to: it has no offset worth preserving.
    expect(inert.scrollTop).toBe(0)
    void container
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

// A row that enters an already-mounted list (e.g. a redo/reopen bringing a
// row back into the active section) has no prior position to glide from — it
// lands at its full final layout position the instant React commits it, in
// the same frame a sibling that must make room for it is still transform-held
// at its *old* spot, which is exactly where the entrant now sits. Left with no
// animation at all (the pre-fix behavior), the two rendered solidly on top of
// each other until the sibling's glide caught up.
describe('FlipList row enter animation', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    // jsdom implements no Web Animations API, so the stub below is an added
    // property rather than a spy — restoreAllMocks doesn't know about it.
    delete (Element.prototype as Partial<Element>).animate
  })

  function stubAnimate() {
    const calls: { el: Element; keyframes: Keyframe[] }[] = []
    Object.defineProperty(Element.prototype, 'animate', {
      value: function (this: Element, keyframes: Keyframe[]) {
        calls.push({ el: this, keyframes })
        return { finished: new Promise(() => {/* never settles */}), cancel: vi.fn() } as unknown as Animation
      },
      configurable: true,
      writable: true,
    })
    return calls
  }

  it('fades a row in, rather than leaving it un-animated, when it enters an already-mounted list', () => {
    const { rerender } = render(
      <FlipList items={['a']} itemAttr="data-key">
        <div data-key="a">Row A</div>
      </FlipList>,
    )

    const calls = stubAnimate()

    rerender(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    const rowBCalls = calls.filter(c => (c.el as HTMLElement).getAttribute('data-key') === 'b')
    expect(rowBCalls).toHaveLength(1)
    expect(rowBCalls[0]!.keyframes).toEqual([
      { opacity: 0, transform: 'translateY(-10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ])
  })

  it('does not animate any row on initial mount', () => {
    const calls = stubAnimate()
    render(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )
    expect(calls).toHaveLength(0)
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
