// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FlipList } from './FlipList'

/**
 * Stands in for the absent jsdom `Element.animate`, recording which element was
 * asked to animate what so a caller can assert on the glide.
 */
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

/** jsdom does no layout, so drive each row's measured top by hand. */
function stubTops(tops: Record<string, number>) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const key = this.getAttribute('data-key')
    return ({ top: key ? tops[key] ?? 0 : 0, left: 0, width: 0, height: 0 }) as DOMRect
  })
}

function keyframesFor(calls: { el: Element; keyframes: Keyframe[] }[], key: string) {
  return calls.filter(c => (c.el as HTMLElement).getAttribute('data-key') === key).map(c => c.keyframes)
}

afterEach(() => {
  vi.restoreAllMocks()
  // jsdom implements no Web Animations API, so the stub is an added property
  // rather than a spy — restoreAllMocks doesn't know about it.
  delete (Element.prototype as Partial<Element>).animate
})

describe('FlipList', () => {
  beforeEach(() => { stubAnimate() })

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
})

describe('FlipList row glide', () => {
  it('glides a row from where it was to where this render put it', () => {
    stubTops({ a: 0, b: 100 })
    const { rerender } = render(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    const calls = stubAnimate()
    stubTops({ a: 0, b: 40 }) // b moved up 60px
    rerender(
      <FlipList items={['a', 'b2']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    expect(keyframesFor(calls, 'b')).toEqual([[
      { transform: 'translateY(60px)' },
      { transform: 'translateY(0)' },
    ]])
  })

  // A row entering an already-mounted list has no previous position to glide
  // from: it lands at its final spot in the same frame a sibling making room
  // for it is still transform-held at that very spot. Un-animated, the two
  // render solidly on top of each other until the sibling catches up.
  it('fades a row in when it enters an already-mounted list', () => {
    stubTops({ a: 0 })
    const { rerender } = render(
      <FlipList items={['a']} itemAttr="data-key">
        <div data-key="a">Row A</div>
      </FlipList>,
    )

    const calls = stubAnimate()
    stubTops({ a: 0, b: 100 })
    rerender(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    expect(keyframesFor(calls, 'b')).toEqual([[
      { opacity: 0, transform: 'translateY(-10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ]])
  })

  it('does not animate any row on initial mount', () => {
    const calls = stubAnimate()
    stubTops({ a: 0, b: 100 })
    render(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )
    expect(calls).toHaveLength(0)
  })

  it('leaves an in-flight glide alone when a re-render commits the same layout', () => {
    stubTops({ a: 0, b: 100 })
    const { rerender } = render(
      <FlipList items={['a', 'b']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    const calls = stubAnimate()
    rerender(
      <FlipList items={['a', 'b2']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    expect(calls).toHaveLength(0)
  })
})

// While a row is collapsing on its way out (CollapseRow), the rows after it
// move continuously, with no re-render per frame. A commit landing mid-collapse
// must not glide them a second time — from wherever the transition has got to,
// towards a target it is still moving.
describe('FlipList suspended', () => {
  it('does not animate while a CSS transition owns the layout', () => {
    stubTops({ a: 0, b: 100 })
    const { rerender } = render(
      <FlipList items={['a', 'b']} itemAttr="data-key" suspended>
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    const calls = stubAnimate()
    stubTops({ a: 0, b: 60 }) // mid-collapse, still moving
    rerender(
      <FlipList items={['a', 'b2']} itemAttr="data-key" suspended>
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    expect(calls).toHaveLength(0)
  })

  // The commit that ends a suspension is the one where the collapsed row
  // unmounts, and every position it reports was put there by the transition
  // that just finished. Animating from the pre-collapse baseline here would
  // replay the whole collapse as a glide.
  it('does not animate on the commit that ends the suspension', () => {
    stubTops({ a: 0, b: 100 })
    const { rerender } = render(
      <FlipList items={['a', 'b']} itemAttr="data-key" suspended>
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    const calls = stubAnimate()
    stubTops({ a: 0, b: 40 }) // where the finished transition left it
    rerender(
      <FlipList items={['a', 'b2']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    expect(calls).toHaveLength(0)
  })

  it('glides again on the next commit, from where CSS left things', () => {
    stubTops({ a: 0, b: 100 })
    const { rerender } = render(
      <FlipList items={['a', 'b']} itemAttr="data-key" suspended>
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    stubTops({ a: 0, b: 40 })
    rerender(
      <FlipList items={['a', 'b2']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    const calls = stubAnimate()
    stubTops({ a: 0, b: 90 }) // a genuine reorder, 50px down from where CSS left it
    rerender(
      <FlipList items={['a', 'b3']} itemAttr="data-key">
        <div data-key="a">Row A</div>
        <div data-key="b">Row B</div>
      </FlipList>,
    )

    expect(keyframesFor(calls, 'b')).toEqual([[
      { transform: 'translateY(-50px)' },
      { transform: 'translateY(0)' },
    ]])
  })
})
