import { describe, it, expect } from 'vitest'
import { sortOccs } from './occSort'
import type { Occurrence } from '@/types'

function makeOcc(overrides: Partial<Occurrence> & { title?: string; done?: boolean; jsTime?: Date; duration?: string } = {}): Occurrence {
  const { title = '', done, jsTime, duration, ...rest } = overrides
  return {
    date: '2020-01-01',
    time: null,
    source: 'explicit',
    fileSlug: 'note.md',
    id: title || 'occ',
    metadata: { participants: [], title, tags: [], items: [], done, jsTime, duration },
    ...rest,
  }
}

describe('sortOccs', () => {
  it('groups done/past items by type (events before tasks) before sorting alphabetically', () => {
    const pastEvent = makeOcc({ title: 'Zebra event', jsTime: new Date(2020, 0, 1, 9, 0) })
    const doneTaskB = makeOcc({ title: 'Banana task', done: true })
    const doneTaskA = makeOcc({ title: 'Apple task', done: true })

    const sorted = sortOccs([pastEvent, doneTaskB, doneTaskA])

    expect(sorted.map(o => o.metadata.title)).toEqual(['Zebra event', 'Apple task', 'Banana task'])
  })

  it('keeps active items grouped ahead of done/past items', () => {
    const doneTask = makeOcc({ title: 'Aardvark done', done: true })
    const openTask = makeOcc({ title: 'Zoo open task' })

    const sorted = sortOccs([doneTask, openTask])

    expect(sorted.map(o => o.metadata.title)).toEqual(['Zoo open task', 'Aardvark done'])
  })
})
