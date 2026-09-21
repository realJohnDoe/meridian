// @vitest-environment jsdom
import { useRef } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import type { VirtualItem } from '@tanstack/react-virtual'
import { useVirtualFlip, FLIP_KEY_ATTR } from './useVirtualFlip'

// jsdom doesn't implement the Web Animations API, so element.animate() is
// absent entirely — stub it and read back what the hook asked for.
const animate = vi.fn((_keyframes: Keyframe[], _options?: KeyframeAnimationOptions) => ({ cancel: vi.fn() }))
let animateDescriptor: PropertyDescriptor | undefined

beforeEach(() => {
  // mockReset, not mockClear: one test below swaps in its own return value to
  // watch cancellation, and that would otherwise leak into later tests.
  animate.mockReset()
  animate.mockReturnValue({ cancel: vi.fn() })
  // On Element, not HTMLElement: that's where WAAPI defines it, and it's what
  // the hook's feature detect checks.
  animateDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate')
  Object.defineProperty(Element.prototype, 'animate', { configurable: true, writable: true, value: animate })
})

afterEach(() => {
  if (animateDescriptor) Object.defineProperty(Element.prototype, 'animate', animateDescriptor)
  else delete (Element.prototype as { animate?: unknown }).animate
})

/** `start` is all the hook reads; the rest is VirtualItem shape. */
function item(key: string, start: number): VirtualItem {
  return { key, index: 0, start, end: start + 68, size: 68, lane: 0 }
}

function Harness({ items, rowsKey, isScrolling }: {
  items: VirtualItem[]
  rowsKey: unknown
  isScrolling: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useVirtualFlip(ref, items, rowsKey, isScrolling)
  return (
    <div ref={ref}>
      {items.map(vi => <div key={vi.key} {...{ [FLIP_KEY_ATTR]: vi.key }} />)}
    </div>
  )
}

function setup(items: VirtualItem[], rowsKey: unknown, isScrolling = false) {
  const { rerender } = render(<Harness items={items} rowsKey={rowsKey} isScrolling={isScrolling} />)
  return {
    update: (nextItems: VirtualItem[], nextRowsKey: unknown, nextScrolling = false) =>
      rerender(<Harness items={nextItems} rowsKey={nextRowsKey} isScrolling={nextScrolling} />),
  }
}

/**
 * jsdom reports `scrollTop` as 0 for every element, so the hook's scroll term
 * needs stubbing to model a commit that also corrected the scroll offset.
 */
function withScrollTop(value: number, run: () => void): void {
  withStubbed('scrollTop', value, run)
}

/**
 * jsdom lays nothing out, so the container reports a zero-height viewport.
 * Give it a real one, or a test about a row travelling further than a screen
 * is measuring against a screen of no height at all.
 */
function withViewportHeight(value: number, run: () => void): void {
  withStubbed('clientHeight', value, run)
}

function withStubbed(prop: 'scrollTop' | 'clientHeight', value: number, run: () => void): void {
  // Both are real accessors on Element.prototype in jsdom, so there is always
  // a descriptor to put back — unlike `animate`, which jsdom omits entirely.
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, prop)!
  Object.defineProperty(Element.prototype, prop, { configurable: true, get: () => value })
  try { run() } finally { Object.defineProperty(Element.prototype, prop, descriptor) }
}

/** The `from` offset of each glide the hook started, in call order. */
const glideOffsets = () =>
  animate.mock.calls.map(([keyframes]) => keyframes[0]!.transform)

describe('useVirtualFlip', () => {
  it('glides a row from its previous position when the rows change', () => {
    const rowsA = ['a']
    const { update } = setup([item('a', 200)], rowsA)
    expect(animate).not.toHaveBeenCalled() // first run has nothing to glide from

    update([item('a', 132)], ['b'])

    // Moved up 68px, so it starts 68px below where it now sits and settles.
    expect(glideOffsets()).toEqual(['translateY(68px)'])
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: 'translateY(68px)' },
      { transform: 'translateY(0)' },
    ])
  })

  it('does not glide when only measurements shifted the rows (same rows identity)', () => {
    // The critical guard: scrolling through not-yet-measured rows constantly
    // changes `start` as each row is measured against its estimate. Animating
    // those would make the whole list shimmer on an ordinary scroll.
    const rows = ['a']
    const { update } = setup([item('a', 200)], rows)

    update([item('a', 132)], rows)

    expect(animate).not.toHaveBeenCalled()
  })

  it('does not glide while the list is scrolling', () => {
    const { update } = setup([item('a', 200)], ['a'])

    update([item('a', 132)], ['b'], true)

    expect(animate).not.toHaveBeenCalled()
  })

  it('does not glide a row that just entered the window', () => {
    const { update } = setup([item('a', 200)], ['a'])

    // 'b' has no previous position — it scrolled or was added into view.
    update([item('a', 200), item('b', 268)], ['a', 'b'])

    expect(animate).not.toHaveBeenCalled()
  })

  it('ignores sub-pixel drift', () => {
    const { update } = setup([item('a', 200)], ['a'])

    update([item('a', 200.5)], ['b'])

    expect(animate).not.toHaveBeenCalled()
  })

  it('glides from the row\'s last position even across renders it did not animate', () => {
    const rows = ['a']
    const { update } = setup([item('a', 200)], rows)

    // A measurement-only shift: not animated, but it *is* where the row now is.
    update([item('a', 150)], rows)
    expect(animate).not.toHaveBeenCalled()

    // So the next real change glides from 150, not from the stale 200.
    update([item('a', 100)], ['b'])
    expect(glideOffsets()).toEqual(['translateY(50px)'])
  })

  it('does not glide rows the scroll offset was corrected to hold in place', () => {
    // A filter change dropping thousands of rows above moves the survivors
    // enormously; the agenda compensates the scroll offset by the same amount
    // so they stay put on screen, and animating that delta would fling them
    // across it. What the row visibly did is nothing, so nothing animates.
    withViewportHeight(600, () => {
      withScrollTop(300_000, () => {
        const { update } = setup([item('a', 300_000)], ['a'])
        withScrollTop(200, () => { update([item('a', 200)], ['b']) })
      })
    })

    expect(animate).not.toHaveBeenCalled()
  })

  it('glides a row that moved further than the viewport without a scroll correction', () => {
    // Checking off a prioritised task sends it from the top of a day's active
    // bucket past every open item below it (occSort.ts). On a busy day that is
    // further than a screen, but the scroll offset did not move — so this is a
    // real, visible journey and the row has to make it continuously. A
    // one-viewport cap here used to drop exactly this row, leaving the one the
    // user just touched as the only one that jumped.
    withViewportHeight(600, () => {
      const { update } = setup([item('a', 200)], ['a'])
      update([item('a', 1_400)], ['b'])
    })

    expect(glideOffsets()).toEqual(['translateY(-1200px)'])
  })

  it('skips silently where the Web Animations API is absent', () => {
    // This runs in a layout effect, so a TypeError here would take the whole
    // agenda down rather than just dropping an animation.
    delete (Element.prototype as { animate?: unknown }).animate
    const { update } = setup([item('a', 200)], ['a'])

    expect(() => update([item('a', 132)], ['b'])).not.toThrow()
  })

  it('cancels an in-flight glide before starting a new one', () => {
    const cancel = vi.fn()
    animate.mockReturnValue({ cancel })
    const { update } = setup([item('a', 200)], ['a'])

    update([item('a', 132)], ['b'])
    expect(cancel).not.toHaveBeenCalled()

    update([item('a', 200)], ['c'])
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
