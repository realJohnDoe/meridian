import { describe, it, expect } from 'vitest'
import { scrollabilityFault, type ScrollGeometry } from './agendaScrollability'

/**
 * The fault this reports is the one the agenda's scroll machinery cannot detect
 * for itself — see agendaScrollability.ts. The numbers below are the real
 * measurements from the shipped bug and from a healthy agenda beside it, both
 * taken at a 412x915 viewport.
 */

const geometry = (g: Partial<ScrollGeometry>): ScrollGeometry =>
  ({ clientHeight: 779, scrollHeight: 9043, totalSize: 9043, viewportHeight: 915, ...g })

describe('scrollabilityFault', () => {
  it('reports a scroll container taller than the viewport', () => {
    // The shipped bug, exactly: the shell lost its cap, so the element grew to
    // its content and the document scrolled instead.
    const fault = scrollabilityFault(geometry({ clientHeight: 11152, scrollHeight: 11152, totalSize: 9043 }))
    expect(fault).toMatch(/taller than the viewport/)
    expect(fault).toContain('11152')
    expect(fault).toContain('915')
  })

  it('catches that case even though the rows "fit" the blown-up container', () => {
    // Worth its own case: totalSize (9043) is *less* than clientHeight (11152),
    // so a check phrased only as "is there more content than room" reads this
    // as healthy. It is the reason this file exists in two parts.
    const g = geometry({ clientHeight: 11152, scrollHeight: 11152, totalSize: 9043 })
    expect(g.totalSize).toBeLessThan(g.clientHeight)
    expect(scrollabilityFault(g)).not.toBeNull()
  })

  it('reports a container with rows to show and no overflow to show them in', () => {
    const fault = scrollabilityFault(geometry({ clientHeight: 779, scrollHeight: 779, totalSize: 9043 }))
    expect(fault).toMatch(/cannot scroll/)
    expect(fault).toContain('9043')
  })

  it('stays quiet on a healthy agenda', () => {
    expect(scrollabilityFault(geometry({}))).toBeNull()
  })

  it('stays quiet when the list genuinely fits on screen', () => {
    // A short vault: nothing overflows, so no overflow is expected either.
    expect(scrollabilityFault(geometry({ clientHeight: 779, scrollHeight: 779, totalSize: 400 }))).toBeNull()
  })

  it('stays quiet before anything has been laid out', () => {
    // A fresh mount, a hidden tab, or any jsdom test — clientHeight 0 means
    // "not measured yet", which is not the same as "broken".
    expect(scrollabilityFault(geometry({ clientHeight: 0, scrollHeight: 0 }))).toBeNull()
  })

  it('stays quiet when the viewport is unknown rather than guessing', () => {
    expect(scrollabilityFault(geometry({ clientHeight: 11152, scrollHeight: 11152, totalSize: 9043, viewportHeight: 0 })))
      .toBeNull()
  })

  it('stays quiet with no element', () => {
    expect(scrollabilityFault(null)).toBeNull()
  })
})
