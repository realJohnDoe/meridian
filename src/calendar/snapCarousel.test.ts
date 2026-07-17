import { describe, it, expect } from 'vitest'
import { snapIndex, maxVisibleFor } from './snapCarousel'

describe('snapIndex', () => {
  it('resolves the centered pane at rest', () => {
    expect(snapIndex(400, 400)).toBe(1)
  })

  it('resolves forward and backward panes', () => {
    expect(snapIndex(800, 400)).toBe(2)
    expect(snapIndex(0, 400)).toBe(0)
  })

  it('returns null when not settled on a snap point', () => {
    expect(snapIndex(210, 400)).toBeNull()
  })

  it('returns null for a zero or NaN paneW instead of dividing by it', () => {
    expect(snapIndex(400, 0)).toBeNull()
    expect(snapIndex(400, NaN)).toBeNull()
  })

  it('tolerates fractional paneW rounding error at higher indices', () => {
    // 393.5px is a plausible fractional CSS width at 3x DPR. An integer-rounded
    // paneW (393) would accumulate a 1px error by idx 2 and fail a <1px tolerance —
    // this is the bug the fractional-width requirement exists to prevent.
    const paneW = 393.5
    expect(snapIndex(2 * paneW, paneW)).toBe(2)
  })
})

describe('maxVisibleFor', () => {
  it('falls back to 3 before measurement is available', () => {
    expect(maxVisibleFor(0, 5, 0)).toBe(3)
    expect(maxVisibleFor(400, 0, 20)).toBe(3)
    expect(maxVisibleFor(400, 5, 0)).toBe(3)
  })

  it('clamps to a minimum of 1 on a cramped cell', () => {
    expect(maxVisibleFor(50, 6, 40)).toBe(1)
  })

  it('clamps to a maximum of 8 on a tall cell', () => {
    expect(maxVisibleFor(5000, 5, 10)).toBe(8)
  })

  it('reproduces the original hand-computed formula for a typical layout', () => {
    // 6 week rows in a 900px grid → 150px per cell; rowH 22px.
    // cellH - CELL_CHROME(26) = 124; floor((124 + 2) / (22 + 2)) = 5
    expect(maxVisibleFor(900, 6, 22)).toBe(5)
  })
})
