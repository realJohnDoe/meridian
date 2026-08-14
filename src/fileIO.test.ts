import { describe, it, expect } from 'vitest'
import {
  entryKey, parseEntryKey, keyVaultId, keySlug, isEntryKey, pathToKey, keyToPath,
  pathToSlug, slugToPath,
  type EntryKey,
} from './fileIO'

describe('entryKey', () => {
  it('round-trips a vault id and slug', () => {
    const k = entryKey('work', 'meeting-notes')
    expect(k).toBe('work::meeting-notes')
    expect(parseEntryKey(k)).toEqual({ vaultId: 'work', fileSlug: 'meeting-notes' })
    expect(keyVaultId(k)).toBe('work')
    expect(keySlug(k)).toBe('meeting-notes')
  })

  it('keeps the same slug in two vaults distinct', () => {
    const a = entryKey('work', 'notes')
    const b = entryKey('personal', 'notes')
    expect(a).not.toBe(b)
    expect(new Set([a, b]).size).toBe(2)
    expect(keySlug(a)).toBe(keySlug(b))
  })

  it('splits on the FIRST separator, so a slug may itself contain one', () => {
    const k = entryKey('work', 'odd::slug')
    expect(parseEntryKey(k)).toEqual({ vaultId: 'work', fileSlug: 'odd::slug' })
  })

  it('treats a separator-less string as a bare slug in an unknown vault', () => {
    expect(parseEntryKey('meeting-notes' as EntryKey))
      .toEqual({ vaultId: '', fileSlug: 'meeting-notes' })
    expect(isEntryKey('meeting-notes')).toBe(false)
    expect(isEntryKey('work::meeting-notes')).toBe(true)
  })

  it('survives a UUID vault id (existing vaults keep theirs)', () => {
    const id = '3f2a5c9e-1b4d-4f7a-9c2e-8a1b3c5d7e9f'
    expect(keyVaultId(entryKey(id, 'x'))).toBe(id)
  })

  it('maps to and from a vault path', () => {
    const k = pathToKey('work', 'meeting-notes.md')
    expect(k).toBe('work::meeting-notes')
    expect(keyToPath(k)).toBe('meeting-notes.md')
  })

  it('agrees with pathToSlug/slugToPath on the slug half', () => {
    const path = 'sub/dir/note.md'
    expect(keySlug(pathToKey('v', path))).toBe(pathToSlug(path))
    expect(keyToPath(pathToKey('v', path))).toBe(slugToPath(pathToSlug(path)))
  })
})
