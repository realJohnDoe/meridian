/**
 * The flight recorder is only worth having if it is *readable under pressure*:
 * the assertions here are about the properties someone reads a dump for —
 * ordering, spacing between events, the fingerprint that says "the same bytes
 * went out twice", and the bound that keeps a long session from evicting the
 * history a conflict needs.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { journal, hashContent, syncJournalEvents, syncJournalDump, clearSyncJournal } from '@/storage/syncJournal'

beforeEach(() => { clearSyncJournal() })
afterEach(() => { vi.useRealTimers() })

describe('hashContent', () => {
  it('is stable for the same bytes and different for a one-character change', () => {
    expect(hashContent('title: Buy milk\n')).toBe(hashContent('title: Buy milk\n'))
    expect(hashContent('priority: 1')).not.toBe(hashContent('priority: 2'))
  })

  it('never leaks the content it fingerprints', () => {
    // The dump is meant to be pasteable into a bug report without the user
    // having to audit their own notes first.
    expect(hashContent('a very private note')).not.toContain('private')
  })
})

describe('journal', () => {
  it('records events oldest-first with their detail intact', () => {
    journal('edit', 'v1', 'task.md', { localHash: 'abc', bytes: 42 })
    journal('push', 'v1', 'task.md', { expected: 'sha1' })

    const events = syncJournalEvents()
    expect(events.map(e => e.kind)).toEqual(['edit', 'push'])
    expect(events[0]!.detail).toMatchObject({ localHash: 'abc', bytes: 42 })
    expect(events[1]!.detail?.expected).toBe('sha1')
  })

  it('stamps the gap since the previous event for the same path', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 16, 9, 0, 0))
    journal('edit', 'v1', 'task.md')
    vi.setSystemTime(new Date(2026, 7, 16, 9, 0, 3))
    journal('push', 'v1', 'task.md')

    // Spacing is the whole diagnosis for a race — three seconds between an edit
    // and its push reads very differently from three minutes.
    expect(syncJournalEvents()[1]!.detail?.sincePrevMs).toBe(3000)
  })

  it('measures the gap per path, not globally', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 16, 9, 0, 0))
    journal('edit', 'v1', 'a.md')
    vi.setSystemTime(new Date(2026, 7, 16, 9, 0, 5))
    journal('edit', 'v1', 'b.md')

    expect(syncJournalEvents()[1]!.detail?.sincePrevMs).toBeUndefined()
  })

  it('keeps the newest events once it is full', () => {
    for (let i = 0; i < 500; i++) journal('push', 'v1', `f${i}.md`)

    const events = syncJournalEvents()
    expect(events.length).toBe(400)
    expect(events[events.length - 1]!.path).toBe('f499.md')
  })

  it('narrows to one path, so a conflict report carries that file only', () => {
    journal('push', 'v1', 'task.md')
    journal('push', 'v1', 'other.md')
    journal('push-conflict', 'v1', 'task.md')

    const forTask = syncJournalEvents({ path: 'task.md' })
    expect(forTask).toHaveLength(2)
    expect(forTask.every(e => e.path === 'task.md')).toBe(true)
  })

  it('separates two vaults holding the same path', () => {
    journal('push', 'work', 'task.md')
    journal('push', 'personal', 'task.md')

    expect(syncJournalEvents({ vaultId: 'work', path: 'task.md' })).toHaveLength(1)
  })
})

describe('syncJournalDump', () => {
  it('renders each event with its age, kind, path and detail', () => {
    journal('push-conflict', 'v1', 'task.md', { expected: 'sha1', status: 409, reason: 'ref race' }, 'github')

    const dump = syncJournalDump({ path: 'task.md' })
    expect(dump).toContain('1 event(s) for task.md')
    expect(dump).toContain('push-conflict')
    expect(dump).toContain('github task.md')
    expect(dump).toContain('expected=sha1')
    expect(dump).toContain('status=409')
    expect(dump).toContain('reason=ref race')
  })

  it('omits detail fields that were never set', () => {
    journal('push', 'v1', 'task.md', { expected: 'sha1', actual: undefined })
    expect(syncJournalDump()).not.toContain('actual=')
  })

  it('reads as an empty report rather than throwing when nothing was recorded', () => {
    expect(syncJournalDump()).toBe('meridian sync journal — 0 event(s)')
  })
})
