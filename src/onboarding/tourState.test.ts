// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { isTourDone, markTourDone } from './tourState'

beforeEach(() => {
  localStorage.clear()
})

describe('tourState', () => {
  it('reports the tour as not done until markTourDone is called', () => {
    expect(isTourDone()).toBe(false)
    markTourDone()
    expect(isTourDone()).toBe(true)
  })

  it('treats a getItem failure as done, so a broken localStorage never replays the tour', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(isTourDone()).toBe(true)
  })

  it('swallows a setItem failure instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(() => markTourDone()).not.toThrow()
  })
})
