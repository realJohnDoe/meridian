import { describe, it, expect } from 'vitest'
import { sortOccs } from './occSort'
import type { Occurrence } from '@/types'
import { testKey, TEST_VAULT } from '@/test-utils'

// Fixed clock well after every fixture's jsTime below, so `event-past`/
// `event-future` classification is deterministic regardless of when the
// test suite actually runs (sortOccs takes `now` as a required argument
// instead of reading the wall clock itself).
const NOW = new Date(2026, 5, 15, 12, 0)

function makeOcc(overrides: Partial<Occurrence> & { title?: string; done?: boolean; jsTime?: Date; duration?: string } = {}): Occurrence {
  const { title = '', done, jsTime, duration, ...rest } = overrides
  return {
    date: '2020-01-01',
    time: null,
    source: 'explicit',
    entryKey: testKey('note.md'),
    id: title || 'occ',
    metadata: { vaultId: TEST_VAULT, fileSlug: 'note.md', participants: [], title, tags: [], items: [], done, jsTime, duration },
    ...rest,
  }
}

describe('sortOccs', () => {
  it('groups done/past items by type (events before tasks) before sorting alphabetically', () => {
    const pastEvent = makeOcc({ title: 'Zebra event', jsTime: new Date(2020, 0, 1, 9, 0) })
    const doneTaskB = makeOcc({ title: 'Banana task', done: true })
    const doneTaskA = makeOcc({ title: 'Apple task', done: true })

    const sorted = sortOccs([pastEvent, doneTaskB, doneTaskA], NOW)

    expect(sorted.map(o => o.metadata.title)).toEqual(['Zebra event', 'Apple task', 'Banana task'])
  })

  it('orders timed events and timed tasks by clock time, ahead of untimed tasks', () => {
    const day = (h: number) => new Date(2026, 5, 16, h, 0)
    const d = '2026-06-16'
    const untimed = makeOcc({ title: 'Untimed task', date: d, done: false })
    const meeting = makeOcc({ title: 'Meeting', date: d, time: '10:00', jsTime: day(10) })
    const rent = makeOcc({ title: 'Pay rent', date: d, time: '09:00', jsTime: day(9), done: false })

    const sorted = sortOccs([untimed, meeting, rent], NOW)

    expect(sorted.map(o => o.metadata.title)).toEqual(['Pay rent', 'Meeting', 'Untimed task'])
  })

  it('lets clock time beat priority among timed items', () => {
    const day = (h: number) => new Date(2026, 5, 16, h, 0)
    const d = '2026-06-16'
    const late = makeOcc({ title: 'Late urgent', date: d, time: '15:00', jsTime: day(15), done: false })
    late.metadata.priority = 'high'
    const early = makeOcc({ title: 'Early', date: d, time: '08:00', jsTime: day(8), done: false })

    expect(sortOccs([late, early], NOW).map(o => o.metadata.title)).toEqual(['Early', 'Late urgent'])
  })

  it('keeps active items grouped ahead of done/past items', () => {
    const doneTask = makeOcc({ title: 'Aardvark done', done: true })
    const openTask = makeOcc({ title: 'Zoo open task' })

    const sorted = sortOccs([doneTask, openTask], NOW)

    expect(sorted.map(o => o.metadata.title)).toEqual(['Zoo open task', 'Aardvark done'])
  })
})
