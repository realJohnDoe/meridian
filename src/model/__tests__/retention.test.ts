/**
 * The retention sweep's predicate — plans/archived-entries.md PR 4a, table
 * case by case, including both traps and both `after_completion` directions.
 */
import { describe, it, expect } from 'vitest'
import { entryKey } from '@/fileIO'
import type { StoreItem, StoreOcc, StoreSeries } from '@/types'
import { isEntryFinished } from '@/model/retention'

const KEY = entryKey('vault', 'entry')
const TODAY = new Date(2026, 5, 15) // 2026-06-15

function standalone(over: Partial<StoreOcc> & { metadata: StoreOcc['metadata'] }): StoreOcc {
  return { date: '', time: null, source: 'explicit', entryKey: KEY, id: 'o1', ...over }
}

function series(over: Partial<StoreSeries> & Pick<StoreSeries, 'repeat'>): StoreSeries {
  return { date: '2026-01-01', time: null, entryKey: KEY, id: 's1', metadata: { participants: [] }, ...over }
}

function child(over: Partial<StoreOcc> & { ownerId: string; metadata: StoreOcc['metadata'] }): StoreOcc {
  return { date: '', time: null, source: 'explicit', entryKey: KEY, id: 'c1', ...over }
}

describe('isEntryFinished — standalone occurrences', () => {
  it('tracked, done: true — finished', () => {
    expect(isEntryFinished([standalone({ metadata: { participants: [], done: true } })], TODAY)).toBe(true)
  })

  it('tracked, done: false — not finished (the isTracked trap: never !!done)', () => {
    expect(isEntryFinished([standalone({ metadata: { participants: [], done: false } })], TODAY)).toBe(false)
  })

  it('untracked, past date — finished', () => {
    expect(isEntryFinished([standalone({ date: '2026-01-01', metadata: { participants: [] } })], TODAY)).toBe(true)
  })

  it('untracked, future date — not finished', () => {
    expect(isEntryFinished([standalone({ date: '2026-12-01', metadata: { participants: [] } })], TODAY)).toBe(false)
  })

  it('undated and untracked (a note) — not finished', () => {
    expect(isEntryFinished([standalone({ date: '', metadata: { participants: [] } })], TODAY)).toBe(false)
  })
})

describe('isEntryFinished — schedule series', () => {
  it('repeat.end absent — never finished, however old (the "never ends" trap: absence, not a \'never\' value)', () => {
    const s = series({
      date: '2020-01-01',
      repeat: { type: 'schedule', freq: 'daily' },
    })
    expect(isEntryFinished([s], TODAY)).toBe(false)
  })

  it('bounded and exhausted — every occurrence past (event) — finished', () => {
    const s = series({
      date: '2026-01-01',
      repeat: { type: 'schedule', freq: 'daily', end: { type: 'count', occurrences: 3 } },
    })
    expect(isEntryFinished([s], TODAY)).toBe(true)
  })

  it('bounded but not exhausted — a future occurrence remains — not finished', () => {
    const s = series({
      date: '2026-06-01',
      repeat: { type: 'schedule', freq: 'daily', end: { type: 'until', date: '2026-12-31' } },
    })
    expect(isEntryFinished([s], TODAY)).toBe(false)
  })

  it('bounded and exhausted, tracked — finished only when every occurrence is done', () => {
    const s = series({
      date: '2026-01-01',
      metadata: { participants: [], done: false },
      repeat: { type: 'schedule', freq: 'daily', end: { type: 'count', occurrences: 2 } },
    })
    const done1 = child({ date: '2026-01-01', ownerId: 's1', id: 'c1', metadata: { participants: [], done: true } })
    const done2 = child({ date: '2026-01-02', ownerId: 's1', id: 'c2', metadata: { participants: [], done: true } })
    expect(isEntryFinished([s, done1, done2], TODAY)).toBe(true)

    const notDone2 = child({ date: '2026-01-02', ownerId: 's1', id: 'c2', metadata: { participants: [], done: false } })
    expect(isEntryFinished([s, done1, notDone2], TODAY)).toBe(false)
  })
})

describe('isEntryFinished — after_completion series', () => {
  it('a pristine series, never touched — not finished', () => {
    const s = series({ repeat: { type: 'after_completion', interval: '1 day' } })
    expect(isEntryFinished([s], TODAY)).toBe(false)
  })

  it('last occurrence cancelled — finished', () => {
    const s = series({ repeat: { type: 'after_completion', interval: '1 day' } })
    const cancelled = child({ ownerId: 's1', excluded: true, metadata: { participants: [] } })
    expect(isEntryFinished([s, cancelled], TODAY)).toBe(true)
  })

  it('last occurrence completed — not finished (it has just generated another)', () => {
    const s = series({ repeat: { type: 'after_completion', interval: '1 day' } })
    const completed = child({ ownerId: 's1', metadata: { participants: [], done: true } })
    expect(isEntryFinished([s, completed], TODAY)).toBe(false)
  })

  it('an open (undone, non-excluded) occurrence — not finished', () => {
    const s = series({ repeat: { type: 'after_completion', interval: '1 day' } })
    const open = child({ ownerId: 's1', metadata: { participants: [], done: false } })
    expect(isEntryFinished([s, open], TODAY)).toBe(false)
  })
})

describe('isEntryFinished — whole entry', () => {
  it('every item finished — the entry is finished', () => {
    const items: StoreItem[] = [
      standalone({ id: 'a', date: '2026-01-01', metadata: { participants: [] } }),
      standalone({ id: 'b', metadata: { participants: [], done: true } }),
    ]
    expect(isEntryFinished(items, TODAY)).toBe(true)
  })

  it('one unfinished item is enough to keep the whole entry not finished', () => {
    const items: StoreItem[] = [
      standalone({ id: 'a', date: '2026-01-01', metadata: { participants: [] } }),
      standalone({ id: 'b', metadata: { participants: [], done: false } }),
    ]
    expect(isEntryFinished(items, TODAY)).toBe(false)
  })
})
