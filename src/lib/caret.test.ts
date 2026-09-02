// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { caretOffsetFromPoint } from './caret'

// jsdom implements neither caret API, so document.caretPositionFromPoint /
// caretRangeFromPoint don't exist at runtime here even though the DOM lib
// types declare them as always-present — hence defineProperty to add them
// and Reflect.deleteProperty (not the `delete` operator, which TS rejects
// against a non-optional declared type) to remove them again.
afterEach(() => {
  Reflect.deleteProperty(document, 'caretPositionFromPoint')
  Reflect.deleteProperty(document, 'caretRangeFromPoint')
})

describe('caretOffsetFromPoint', () => {
  it('prefers the standard caretPositionFromPoint API', () => {
    const textNode = document.createTextNode('hello')
    Object.defineProperty(document, 'caretPositionFromPoint', {
      value: () => ({ offsetNode: textNode, offset: 3 }),
      configurable: true,
    })
    expect(caretOffsetFromPoint(10, 10)).toBe(3)
  })

  it('falls back to caretRangeFromPoint when the standard API is absent', () => {
    const textNode = document.createTextNode('hello')
    const range = document.createRange()
    range.setStart(textNode, 2)
    Object.defineProperty(document, 'caretRangeFromPoint', {
      value: () => range,
      configurable: true,
    })
    expect(caretOffsetFromPoint(10, 10)).toBe(2)
  })

  it('returns null when the point misses a text node', () => {
    const el = document.createElement('div')
    Object.defineProperty(document, 'caretPositionFromPoint', {
      value: () => ({ offsetNode: el, offset: 0 }),
      configurable: true,
    })
    expect(caretOffsetFromPoint(10, 10)).toBeNull()
  })

  it('returns null when neither API exists', () => {
    expect(caretOffsetFromPoint(10, 10)).toBeNull()
  })
})
