import { describe, it, expect } from 'vitest'
import type { FileMetadata, Roots } from '@/types'
import { entryKey } from '@/fileIO'
import { makeRootMeta, TEST_VAULT } from '@/test-utils'
import { archivedEntriesFor } from './archivedEntries'

const OTHER_VAULT = 'other-vault'

function roots(entries: Array<[string, Partial<FileMetadata>]>): Roots {
  return new Map(entries.map(([slug, partial]) => {
    const meta = makeRootMeta(slug, partial)
    return [entryKey(meta.vaultId, slug), meta]
  }))
}

describe('archivedEntriesFor', () => {
  it('returns only this vault\'s archived entries', () => {
    const r = roots([
      ['keep-me',      { title: 'Keep Me' }],
      ['archived-one', { title: 'Archived One', archived: true }],
      // Archived, but in a different vault — must not show up here.
      ['other-vault-archived', { title: 'Elsewhere', vaultId: OTHER_VAULT, archived: true }],
    ])

    expect(archivedEntriesFor(r, TEST_VAULT)).toEqual([{ key: entryKey(TEST_VAULT, 'archived-one'), title: 'Archived One' }])
  })

  // A hand-written `archived: false` is not archived — same rule fileEntries
  // and the calendar filters honour.
  it('excludes an entry whose archived key is explicitly false', () => {
    const r = roots([['not-archived', { title: 'Not Archived', archived: false }]])
    expect(archivedEntriesFor(r, TEST_VAULT)).toEqual([])
  })

  it('falls back to the fileSlug when the title is empty', () => {
    const r = roots([['untitled-note', { title: '', archived: true }]])
    expect(archivedEntriesFor(r, TEST_VAULT)).toEqual([{ key: entryKey(TEST_VAULT, 'untitled-note'), title: 'untitled-note' }])
  })

  it('sorts by title', () => {
    const r = roots([
      ['zeta',  { title: 'Zeta', archived: true }],
      ['alpha', { title: 'Alpha', archived: true }],
    ])
    expect(archivedEntriesFor(r, TEST_VAULT).map(e => e.title)).toEqual(['Alpha', 'Zeta'])
  })

  it('returns an empty list for a vault with nothing archived', () => {
    const r = roots([['note', { title: 'Note' }]])
    expect(archivedEntriesFor(r, TEST_VAULT)).toEqual([])
  })
})
