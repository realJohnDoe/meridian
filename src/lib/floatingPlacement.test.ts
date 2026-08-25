// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { computeFloatingPlacement } from './floatingPlacement'
import { topChromeBottom } from './topChrome'

// A phone-sized band whose top edge sits below a 54px sticky topbar — the
// callers pass an already-chrome-adjusted visibleTop (see lib/topChrome.ts),
// so that offset is what these fixtures model.
const band = { visibleTop: 54, visibleBottom: 800, innerWidth: 412, innerHeight: 800 }
const at = (top: number, bottom = top + 40) => ({ top, bottom, left: 16 })

describe('computeFloatingPlacement', () => {
  it('opens below the anchor when there is room', () => {
    const p = computeFloatingPlacement(at(200), band)
    expect(p?.side).toBe('bottom')
    expect(p?.top).toBe(246)          // anchor.bottom + GAP
  })

  it('flips above when the space below is too small', () => {
    // Keyboard-shrunk band: only ~60px under the anchor, plenty above it.
    const p = computeFloatingPlacement(at(400), { ...band, visibleBottom: 500 })
    expect(p?.side).toBe('top')
  })

  it('never lets a flipped panel extend up into the chrome', () => {
    // spaceAbove is measured from visibleTop (54), not from 0 — so the panel
    // stops at the topbar rather than sliding underneath it.
    const p = computeFloatingPlacement(at(400), { ...band, visibleBottom: 500 })
    expect(p?.side).toBe('top')
    expect(p!.maxHeight).toBeLessThanOrEqual(400 - 54)
  })

  // The reported case, and the one a preferred-minimum height breaks: the
  // anchor is plainly visible, but the room above it is smaller than the size
  // the panel would like, so flooring up to that size overruns the band.
  it('fits a flipped panel into a gap smaller than its preferred height', () => {
    const anchor = { top: 150, bottom: 190, left: 16 }        // visible: 150 > 54
    const p = computeFloatingPlacement(anchor, { ...band, visibleBottom: 240 })
    expect(p!.side).toBe('top')
    expect(p!.maxHeight).toBeLessThanOrEqual(anchor.top - band.visibleTop)
    // Top edge of the panel at full height must clear the topbar.
    expect(anchor.top - 6 - p!.maxHeight).toBeGreaterThanOrEqual(band.visibleTop)
  })

  it('fits a below-placed panel into a gap smaller than its preferred height', () => {
    const anchor = { top: 100, bottom: 140, left: 16 }
    const p = computeFloatingPlacement(anchor, { ...band, visibleBottom: 220 })
    expect(p!.side).toBe('bottom')
    expect(p!.maxHeight).toBeLessThanOrEqual(220 - anchor.bottom)
    expect(anchor.bottom + 6 + p!.maxHeight).toBeLessThanOrEqual(220)
  })

  it('never reports a negative height when there is no room at all', () => {
    const p = computeFloatingPlacement({ top: 56, bottom: 58, left: 16 }, { ...band, visibleBottom: 60 })
    expect(p!.maxHeight).toBeGreaterThanOrEqual(0)
  })

  describe('when the anchor has left the usable band', () => {
    // The reported bug: scrolling with a combobox open walked the panel up
    // through the topbar, because a panel positioned from its anchor follows
    // the anchor wherever it goes.
    it('hides once the anchor is fully behind the topbar', () => {
      expect(computeFloatingPlacement(at(-60, -10), band)).toBeNull()
    })

    it('hides at the exact boundary, so a zero-height cursor anchor counts as gone', () => {
      expect(computeFloatingPlacement({ top: 54, bottom: 54, left: 16 }, band)).toBeNull()
    })

    it('still shows while the anchor only partly overlaps the topbar', () => {
      // Bottom edge still below the chrome: the panel opens under it, clear of
      // the topbar, so there is nothing to hide yet.
      const p = computeFloatingPlacement(at(30, 80), band)
      expect(p).not.toBeNull()
      expect(p!.side).toBe('bottom')
      expect(p!.top).toBeGreaterThan(band.visibleTop)
    })

    it('hides once the anchor is below the band (behind the keyboard)', () => {
      expect(computeFloatingPlacement(at(820), band)).toBeNull()
    })
  })
})

describe('topChromeBottom', () => {
  afterEach(() => { document.body.innerHTML = '' })

  // jsdom does no layout, so getBoundingClientRect always reports zeros
  // regardless of the CSS applied — stub it the way the topbar's sticky
  // header would actually resolve, to guard against the bare `[data-topbar]`
  // selector silently going unmatched (both `_app` and the entry routes'
  // headers carry it — see routes/_app.tsx and routes/-entryTopbar.tsx).
  it('resolves a non-zero value with a header rendered', () => {
    const header = document.createElement('header')
    header.setAttribute('data-topbar', '')
    document.body.appendChild(header)
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(
      { bottom: 54 } as DOMRect,
    )

    expect(topChromeBottom()).toBe(54)
  })

  it('reports 0 when the route has no topbar', () => {
    expect(topChromeBottom()).toBe(0)
  })
})
