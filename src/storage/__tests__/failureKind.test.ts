import { describe, it, expect } from 'vitest'
import { classifyFailure, isRateLimitError, type FailureKind } from '@/storage/failureKind'

function withStatus(status: number, extra?: Record<string, unknown>) {
  return Object.assign(new Error('http error'), { status, ...extra })
}

describe('classifyFailure', () => {
  // Row 1: no numeric status on the error at all — it never reached GitHub.
  // Every device/browser wording below is covered by this one rule instead
  // of a growing list of message strings to match.
  it.each<[string, unknown]>([
    ['Failed to fetch (Chrome, offline)', new TypeError('Failed to fetch')],
    ['Load failed (Safari)', new TypeError('Load failed')],
    ['The network connection was lost. (iOS Safari)', new TypeError('The network connection was lost.')],
    ['The Internet connection appears to be offline. (iOS Safari)', new TypeError('The Internet connection appears to be offline.')],
    ['NetworkError when attempting to fetch resource. (Firefox)', new TypeError('NetworkError when attempting to fetch resource.')],
    ['AbortError (request killed by backgrounding)', new DOMException('The operation was aborted.', 'AbortError')],
    ['a bare TypeError with an unrecognized message', new TypeError('something went sideways')],
    ['a plain Error with no status at all', new Error('something unexpected')],
  ])('%s classifies as transient (row 1: no status)', (_label, e) => {
    expect(classifyFailure(e).kind).toBe('transient')
  })

  it('401 classifies as auth', () => {
    expect(classifyFailure(withStatus(401)).kind).toBe('auth')
  })

  it('403 with x-ratelimit-remaining: 0 classifies as transient', () => {
    const e = withStatus(403, { response: { headers: { 'x-ratelimit-remaining': '0' } } })
    expect(classifyFailure(e).kind).toBe('transient')
  })

  it('403 with a retry-after header classifies as transient', () => {
    const e = withStatus(403, { response: { headers: { 'retry-after': '60' } } })
    expect(classifyFailure(e).kind).toBe('transient')
  })

  it('403 with a secondary-rate-limit message but no headers classifies as transient', () => {
    const e = Object.assign(new Error('You have exceeded a secondary rate limit'), { status: 403 })
    expect(classifyFailure(e).kind).toBe('transient')
  })

  it('403 with no rate-limit headers or message classifies as access', () => {
    expect(classifyFailure(withStatus(403)).kind).toBe('access')
  })

  it('404 classifies as config', () => {
    expect(classifyFailure(withStatus(404)).kind).toBe('config')
  })

  it.each([408, 429, 500, 502, 503])('%i classifies as transient', status => {
    expect(classifyFailure(withStatus(status)).kind).toBe('transient')
  })

  it.each([409, 422])('%i classifies as conflict', status => {
    expect(classifyFailure(withStatus(status)).kind).toBe('conflict')
  })

  it('an unrecognized status classifies as transient (row 8: anything else)', () => {
    expect(classifyFailure(withStatus(418)).kind).toBe('transient')
  })

  it('carries the status and message through on the Failure value', () => {
    const failure = classifyFailure(withStatus(401))
    expect(failure.status).toBe(401)
    expect(failure.message).toBe('http error')
  })

  it('has no status on a Failure classified without one', () => {
    const failure = classifyFailure(new TypeError('Failed to fetch'))
    expect(failure.status).toBeUndefined()
    expect(failure.message).toBe('Failed to fetch')
  })

  // Exhaustiveness guard: every FailureKind is reachable from some input,
  // so this table can't silently drift from the type as new kinds are added.
  it('covers every FailureKind', () => {
    const seen = new Set<FailureKind>([
      classifyFailure(new TypeError('Failed to fetch')).kind,
      classifyFailure(withStatus(401)).kind,
      classifyFailure(withStatus(403)).kind,
      classifyFailure(withStatus(404)).kind,
      classifyFailure(withStatus(409)).kind,
    ])
    const all: FailureKind[] = ['transient', 'auth', 'access', 'config', 'conflict']
    expect([...seen].sort()).toEqual([...all].sort())
  })
})

describe('isRateLimitError', () => {
  it('returns true when x-ratelimit-remaining is 0', () => {
    expect(isRateLimitError({ response: { headers: { 'x-ratelimit-remaining': '0' } } })).toBe(true)
  })

  it('returns true when a retry-after header is present', () => {
    expect(isRateLimitError({ response: { headers: { 'retry-after': '30' } } })).toBe(true)
  })

  it('returns true when the message names a rate limit but there are no headers', () => {
    expect(isRateLimitError(new Error('secondary rate limit exceeded'))).toBe(true)
  })

  it('returns false for a plain 403 with unrelated headers and message', () => {
    expect(isRateLimitError(Object.assign(new Error('Forbidden'), { response: { headers: { 'content-type': 'application/json' } } }))).toBe(false)
  })
})
