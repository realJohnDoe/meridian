import { describe, it, expect } from 'vitest'
import { maxVisibleFor } from './snapCarousel'

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
