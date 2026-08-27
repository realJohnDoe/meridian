// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { findScrollParent } from './scrollParent'

function makeScroller(overflowY: 'auto' | 'scroll' | 'visible', overflowing: boolean): HTMLElement {
  const el = document.createElement('div')
  el.style.overflowY = overflowY
  // jsdom does no layout, so scrollHeight/clientHeight are always 0 — stub
  // them the way a real overflowing (or not) scroller would report.
  Object.defineProperty(el, 'scrollHeight', { value: overflowing ? 200 : 100, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: 100, configurable: true })
  return el
}

describe('findScrollParent', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('finds the nearest scrollable ancestor that is currently overflowing', () => {
    const scroller = makeScroller('auto', true)
    const child = document.createElement('div')
    scroller.appendChild(child)
    document.body.appendChild(scroller)

    expect(findScrollParent(child)).toBe(scroller)
  })

  it('matches overflow-y: scroll too, not just auto', () => {
    const scroller = makeScroller('scroll', true)
    const child = document.createElement('div')
    scroller.appendChild(child)
    document.body.appendChild(scroller)

    expect(findScrollParent(child)).toBe(scroller)
  })

  // #850: the entry routes' `.flex-1.overflow-y-auto` declares overflow but
  // never scrolls, and handing it back made every read and write against the
  // returned element a silent no-op.
  it('skips a scrollable ancestor that is not currently overflowing', () => {
    const scroller = makeScroller('auto', false)
    const child = document.createElement('div')
    scroller.appendChild(child)
    document.body.appendChild(scroller)

    expect(findScrollParent(child)).toBe(document.scrollingElement)
  })

  it('ignores an ancestor that is not scrollable, however tall its content', () => {
    const notScrollable = makeScroller('visible', true)
    const child = document.createElement('div')
    notScrollable.appendChild(child)
    document.body.appendChild(notScrollable)

    expect(findScrollParent(child)).toBe(document.scrollingElement)
  })

  // The case that regressed in #811: a pane released to `overflow: visible`
  // (the entry routes) leaves nothing for the walk to find, and a null
  // scroller then silently turns a caller's scroll nudge into a no-op.
  it('falls back to the document scroller, not null, when nothing up the tree is scrollable', () => {
    const child = document.createElement('div')
    document.body.appendChild(child)

    expect(findScrollParent(child)).toBe(document.scrollingElement)
    expect(document.scrollingElement).not.toBeNull()
  })
})
