import { describe, it, expect } from 'vitest'
import { computeFloatingPlacement } from './floatingPlacement'

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
