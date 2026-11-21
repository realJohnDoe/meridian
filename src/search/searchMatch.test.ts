import { describe, it, expect } from 'vitest'
import { highlightParts, searchEntries } from './searchMatch'

describe('searchMatch', () => {
  it('matches word prefixes only', () => {
    const e = { title: 'Groceries', tags: [] }
    expect(searchEntries('groc', [e])).toHaveLength(1)
    expect(searchEntries('ceries', [e])).toHaveLength(0)
  })

  it('snippets the first body line with a query word, only for body matches', () => {
    const e = { title: 'T', tags: [], body: 'one\n  two sam here\nsam again' }
    expect(searchEntries('sam', [e])[0]?.snippet).toBe('two sam here')
    expect(searchEntries('t', [e])[0]?.snippet).toBeUndefined()
  })

  it('splits text into plain and matching runs', () => {
    expect(highlightParts('sam', 'Lunch with Sam today')).toEqual(['Lunch with ', 'Sam', ' today'])
  })
})
