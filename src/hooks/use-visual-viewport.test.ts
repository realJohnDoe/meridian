import { describe, it, expect, afterEach, vi } from 'vitest'
import { readVisibleViewport } from './use-visual-viewport'

// The three platform shapes this primitive exists to reconcile. Each stubs the
// globals the way a real browser presents them, so a regression that drops one
// fallback (as 5e7c6d2 did for Firefox Android) fails here rather than on a phone.

interface Stub { innerHeight: number; vv?: { height: number; offsetTop: number } }

function platform({ innerHeight, vv }: Stub) {
  vi.stubGlobal('window', {
    innerHeight,
    visualViewport: vv ?? undefined,
    addEventListener: () => {},
    removeEventListener: () => {},
  })
}

afterEach(() => { vi.unstubAllGlobals() })

describe('readVisibleViewport', () => {
  it('reports the full height with no keyboard open', () => {
    platform({ innerHeight: 800, vv: { height: 800, offsetTop: 0 } })
    expect(readVisibleViewport()).toEqual({ top: 0, height: 800, keyboardInset: 0 })
  })

  it('reads iOS/iPadOS, where only visualViewport shrinks and offsetTop shifts', () => {
    // innerHeight stays at the full screen; the visible strip is what moved.
    platform({ innerHeight: 800, vv: { height: 460, offsetTop: 0 } })
    expect(readVisibleViewport()).toEqual({ top: 0, height: 460, keyboardInset: 340 })
  })

  it('honours visualViewport.offsetTop when iOS scrolls the visual viewport', () => {
    platform({ innerHeight: 800, vv: { height: 460, offsetTop: 120 } })
    expect(readVisibleViewport().top).toBe(120)
  })

  it('falls back to window.innerHeight on Firefox for Android (no visualViewport)', () => {
    // Firefox Android has no visualViewport at all, but its keyboard genuinely
    // shrinks innerHeight — so the visible strip is innerHeight, and there is no
    // second measurement to derive an inset from.
    platform({ innerHeight: 460 })
    expect(readVisibleViewport()).toEqual({ top: 0, height: 460, keyboardInset: 0 })
  })

  it('ignores a browser-chrome-sized delta as not-a-keyboard', () => {
    // A desktop browser shows a permanent few-dozen-pixel layout/visual delta.
    // Treating that as a keyboard would make every popover reserve dead space.
    platform({ innerHeight: 800, vv: { height: 740, offsetTop: 0 } })
    expect(readVisibleViewport().keyboardInset).toBe(0)
  })

  it('counts a delta just past the floor as a keyboard', () => {
    platform({ innerHeight: 800, vv: { height: 679, offsetTop: 0 } })
    expect(readVisibleViewport().keyboardInset).toBe(121)
  })
})
