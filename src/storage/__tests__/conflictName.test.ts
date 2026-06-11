import { describe, it, expect } from 'vitest'
import { conflictPath } from '../conflictName'

const D = new Date('2026-06-11T14:30:22')

describe('conflictPath', () => {
  it('appends timestamp to a plain name', () => {
    expect(conflictPath('note.md', D)).toBe('note_20260611-143022.md')
  })

  it('replaces a previous timestamp suffix rather than appending', () => {
    expect(conflictPath('note_20260101-090000.md', D)).toBe('note_20260611-143022.md')
  })

  it('handles a name with no extension gracefully', () => {
    expect(conflictPath('note', D)).toBe('note_20260611-143022.md')
  })

  it('pads single-digit month/day/hour/minute/second', () => {
    const d = new Date('2026-01-02T03:04:05')
    expect(conflictPath('x.md', d)).toBe('x_20260102-030405.md')
  })

  it('does not grow on repeated conflicts', () => {
    const once = conflictPath('note.md', new Date('2026-01-01T00:00:00'))
    const twice = conflictPath(once, D)
    expect(twice).toBe('note_20260611-143022.md')
  })
})
