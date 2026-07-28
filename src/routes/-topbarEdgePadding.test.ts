import { describe, it, expect } from 'vitest'
import { topbarEdgePadding } from './-topbarEdgePadding'

// An edge that leads with an icon button needs less container padding, because
// the button's own h-10 box already insets it (54 - 40) / 2 = 7px ≈ pr-1.75.
// An edge with no leading button keeps the roomier 14px (pl-3.5 / pr-3.5).
// The two edges are independent, so all four combinations are exercised.
describe('topbarEdgePadding', () => {
  it('tightens both edges when both lead with a button', () => {
    expect(topbarEdgePadding(true, true)).toBe('pr-1.75 pl-1.75')
  })

  it('tightens neither edge when neither leads with a button', () => {
    expect(topbarEdgePadding(false, false)).toBe('pr-3.5 pl-3.5')
  })

  // The real asymmetric case: desktop's left edge is a plain text label while
  // the right edge always leads with an icon button (see _app.tsx).
  it('tightens only the right edge when only it leads with a button', () => {
    expect(topbarEdgePadding(false, true)).toBe('pr-1.75 pl-3.5')
  })

  it('tightens only the left edge when only it leads with a button', () => {
    expect(topbarEdgePadding(true, false)).toBe('pr-3.5 pl-1.75')
  })

  it('never emits both padding values for the same edge', () => {
    for (const left of [true, false]) {
      for (const right of [true, false]) {
        const cls = topbarEdgePadding(left, right)
        expect(cls.match(/\bpl-/g)).toHaveLength(1)
        expect(cls.match(/\bpr-/g)).toHaveLength(1)
      }
    }
  })
})
