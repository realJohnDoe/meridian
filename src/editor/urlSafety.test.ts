import { describe, it, expect } from 'vitest'
import { isSafeUrl } from './urlSafety'

describe('isSafeUrl', () => {
  it.each([
    ['https://x.test/a'],
    ['http://x.test'],
    ['HTTPS://X.TEST'],
    ['mailto:a@b.test'],
  ])('allows %s', (url) => {
    expect(isSafeUrl(url)).toBe(true)
  })

  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html,<script>'],
    ['vbscript:msgbox'],
    ['file:///etc/passwd'],
    ['tel:+1'],
    ['//evil.test'],
    ['/relative/path'],
    [''],
  ])('rejects %s', (url) => {
    expect(isSafeUrl(url)).toBe(false)
  })

  it('rejects leading-whitespace/control-character tricks, since the anchor is what makes this an allowlist', () => {
    expect(isSafeUrl('\n javascript:alert(1)')).toBe(false)
    expect(isSafeUrl(' javascript:alert(1)')).toBe(false)
  })

  it('rejects a scheme-confusion payload with a safe scheme embedded later in the string', () => {
    // Without the `^` anchor, an unanchored /(https?|mailto):/i would match
    // the "https:" substring here and incorrectly allow this — even though
    // the string actually starts with (and a browser would navigate to)
    // `javascript:`.
    expect(isSafeUrl('javascript:alert(1)//https://x.test')).toBe(false)
  })
})
