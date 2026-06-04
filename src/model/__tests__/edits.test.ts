import { describe, it, expect } from 'vitest'
import { parseFixture, serialize } from './helpers'
import { applyEdit, toggleDone, excludeOccurrence, deleteFollowing } from '../storeOps'
import type { EditFields } from '../storeOps'
import { expandRange } from '../expansion'
import { isSeries } from '../../types'
import type { Occurrence, StoreItem } from '../../types'

/** Expand a fixture's items and return the occurrence on `dateISO`. */
function occOn(items: StoreItem[], dateISO: string): Occurrence {
  const occs = expandRange(items, new Date('2026-01-01'), new Date('2026-12-31'))
  const occ = occs.find(o => o.date === dateISO)
  if (!occ) throw new Error(`no occurrence on ${dateISO} (have: ${occs.map(o => o.date).join(', ')})`)
  return occ
}

/** Build EditFields from an occurrence, overriding only what a scenario changes. */
function editFields(occ: Occurrence, over: Partial<EditFields> = {}): EditFields {
  const m = occ.metadata
  return {
    title:        m.title,
    tags:         m.tags ?? [],
    participants: m.participants ?? [],
    body:         m.body ?? '',
    tracked:      m.done !== undefined,
    done:         m.done ?? false,
    priority:     m.priority ?? null,
    scheduled:    occ.date ? { date: occ.date, time: occ.time ?? '' } : null,
    duration:     m.duration ?? '',
    repeat:       null,
    ...over,
  }
}

describe('edit operations → serialized YAML', () => {
  it('toggleDone on a generated occurrence adds a done override', () => {
    const items = parseFixture('weekly-series')
    const next = toggleDone(items, occOn(items, '2026-04-20'))
    expect(serialize(next)).toMatchSnapshot()
  })

  it('single-scope edit overrides one occurrence (priority) without touching the series', () => {
    const items = parseFixture('weekly-series')
    const occ = occOn(items, '2026-04-20')
    const next = applyEdit(items, occ, 'single', editFields(occ, { priority: 'high' }))
    expect(serialize(next)).toMatchSnapshot()
  })

  it('all-scope edit updates the whole series', () => {
    const items = parseFixture('weekly-series')
    const occ = occOn(items, '2026-04-20')
    // For 'all' scope the app targets the series root date/time (applyScope),
    // not the edited occurrence's date — mirror that here.
    const next = applyEdit(items, occ, 'all', editFields(occ, {
      duration: '45m',
      title: 'Team Standup',
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    expect(serialize(next)).toMatchSnapshot()
  })

  it('future-scope edit splits the series at the occurrence date', () => {
    const items = parseFixture('weekly-series')
    const occ = occOn(items, '2026-04-20')
    const next = applyEdit(items, occ, 'future', editFields(occ, { duration: '15m' }))
    // Two series for the same file: capped original + new split.
    expect(next.filter(isSeries)).toHaveLength(2)
    expect(serialize(next)).toMatchSnapshot()
  })

  it('excludeOccurrence drops a single generated occurrence', () => {
    const items = parseFixture('weekly-series')
    const next = excludeOccurrence(items, occOn(items, '2026-04-20'))
    expect(serialize(next)).toMatchSnapshot()
  })

  it('deleteFollowing caps the series end before the occurrence', () => {
    const items = parseFixture('weekly-series')
    const next = deleteFollowing(items, occOn(items, '2026-04-20'))
    expect(serialize(next)).toMatchSnapshot()
  })

  it('creating a new standalone task serializes to a single file', () => {
    const next = applyEdit([], null, 'all', {
      title: 'Buy groceries',
      tags: ['errand'],
      participants: [],
      body: 'Milk, eggs, bread',
      tracked: true,
      done: false,
      priority: 'medium',
      scheduled: { date: '2026-06-05', time: '' },
      duration: '',
      repeat: null,
    })
    expect(serialize(next)).toMatchSnapshot()
  })
})
