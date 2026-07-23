import { describe, it, expect } from 'vitest'
import { parseFixture, serialize } from './helpers'
import { applyEdit } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { expandRange } from '@/model/expansion'
import type { Occurrence, Roots, StoreItem } from '@/types'

function fixtureData(name: string): StoreData {
  const parsed = parseFixture(name)
  return { items: parsed.items, roots: new Map([[name, parsed.root]]) }
}

const FROM = new Date('2026-01-01')
const TO   = new Date('2026-12-31')

function occOn(items: StoreItem[], roots: Roots, dateISO: string): Occurrence {
  const occ = expandRange(items, roots, FROM, TO).find(o => o.date === dateISO)
  if (!occ) throw new Error(`no occurrence on ${dateISO}`)
  return occ
}

function datesIn(data: StoreData, monthPrefix: string): string[] {
  return expandRange(data.items, data.roots, FROM, TO)
    .filter(o => o.date.startsWith(monthPrefix))
    .map(o => o.date)
}

function editFields(occ: Occurrence, over: Partial<EditFields> = {}): EditFields {
  const m = occ.metadata
  return {
    title: m.title, tags: m.tags ?? [], items: m.items ?? [], participants: m.participants ?? [],
    body: m.body ?? '', tracked: m.done !== undefined, done: m.done ?? false,
    priority: m.priority ?? null,
    scheduled: occ.date ? { date: occ.date, time: occ.time ?? '' } : null,
    duration: m.duration ?? '', repeat: null,
    ...over,
  }
}

describe('after_completion: the projected next slot', () => {
  it('reports source "generated" even once materialised as an instance row', () => {
    const data = fixtureData('after-completion-materialised')
    // 2026-07-09 is done, interval is 2 weeks -> 2026-07-23 is the projected slot,
    // and it already exists as a bare instance row.
    expect(occOn(data.items, data.roots, '2026-07-23').source).toBe('generated')
    // A row that is not on the projected slot stays explicit.
    expect(occOn(data.items, data.roots, '2026-07-09').source).toBe('explicit')
  })

  it('honours a date-only exclusion stub on a timed series', () => {
    const data = fixtureData('after-completion-timed')
    expect(datesIn(data, '2026-07')).toEqual(['2026-07-09', '2026-07-23'])

    // A hand-written, date-only `excluded` stub must suppress the 09:00 slot.
    const withStub: StoreData = {
      ...data,
      items: [...data.items, {
        date: '2026-07-23', time: null, source: 'explicit' as const, excluded: true,
        fileSlug: 'after-completion-timed', id: 'stub',
        ownerId: data.items.find(i => 'repeat' in i)!.id,
        metadata: { participants: [] },
      }],
    }
    expect(datesIn(withStub, '2026-07')).toEqual(['2026-07-09'])
  })
})

describe('after_completion: moving the projected occurrence', () => {
  it('suppresses the old slot instead of leaving a duplicate behind', () => {
    let data = fixtureData('after-completion-materialised')
    const occ = occOn(data.items, data.roots, '2026-07-23')

    data = applyEdit(data, occ, 'single', editFields(occ, { scheduled: { date: '2026-07-24', time: '' } }))

    expect(datesIn(data, '2026-07')).toEqual(['2026-07-09', '2026-07-24'])
    expect(serialize(data.items, [...data.roots.values()][0])).toContain(
      '  - date: 2026-07-23\n    excluded: true',
    )
  })

  it('is idempotent when the editor replays the move with its pinned occurrence', () => {
    let data = fixtureData('after-completion-materialised')
    // useEntryEditor pins entry.item for the whole session, so every later save
    // (autosave, flush on close) replays the move with the same pre-move occurrence.
    const pinned = occOn(data.items, data.roots, '2026-07-23')
    const move = () => {
      data = applyEdit(data, pinned, 'single', editFields(pinned, { scheduled: { date: '2026-07-24', time: '' } }))
    }
    move()
    move()
    move()

    expect(datesIn(data, '2026-07')).toEqual(['2026-07-09', '2026-07-24'])
  })

  it('also stays idempotent for a purely virtual occurrence', () => {
    let data = fixtureData('after-completion-timed')
    const pinned = occOn(data.items, data.roots, '2026-07-23')
    expect(pinned.source).toBe('generated')
    const move = () => {
      data = applyEdit(data, pinned, 'single', editFields(pinned, { scheduled: { date: '2026-07-24', time: '09:00' } }))
    }
    move()
    move()

    expect(datesIn(data, '2026-07')).toEqual(['2026-07-09', '2026-07-24'])
  })
})
