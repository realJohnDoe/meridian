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

  // ── split-series ────────────────────────────────────────────────────────────

  it('toggleDone on generated occurrence from the after_completion series targets series2', () => {
    // The split-series fixture has two series: schedule (capped Apr 1–9) and
    // after_completion (from Apr 10). Toggling a generated occurrence from
    // the second series must add an override with ownerId pointing to series2,
    // not series1, and serialize only that override into the file.
    const items = parseFixture('split-series')
    // The after_completion series starts Apr 10 (done:true via override).
    // Its next generated occurrence is Apr 12 (interval: 2 days from Apr 10).
    const occ = occOn(items, '2026-04-12')
    expect(occ.metadata.done).toBe(false)  // generated, not yet done
    const next = toggleDone(items, occ)
    expect(serialize(next)).toMatchSnapshot()
  })

  // ── task-to-event ────────────────────────────────────────────────────────────

  it('all-scope edit on an event series preserves the absence of done', () => {
    // Editing "all" on a series that has no `done` (was converted from task to
    // event) must not re-introduce done into the serialized output.
    const items = parseFixture('task-to-event')
    const occ = occOn(items, '2026-05-07')   // a generated occurrence (no override)
    const next = applyEdit(items, occ, 'all', editFields(occ, {
      scheduled: { date: '2026-05-01', time: '14:00' },  // keep series root date
      title: 'Team Meeting (renamed)',
    }))
    const yaml = serialize(next)
    expect(yaml).toMatchSnapshot()
    // The series itself is an event — `done` must not appear in the defaults: block.
    // (An individual override instance may still carry done: true from when it was tracked.)
    const defaultsBlock = yaml.slice(yaml.indexOf('defaults:'), yaml.indexOf('instances:'))
    expect(defaultsBlock).not.toMatch(/\bdone\b/)
  })

  // ── irregular instances ──────────────────────────────────────────────────────

  it('adding a new occurrence to an irregular-instances file keeps shared defaults', () => {
    // scope 'add' on an irregular-instances file must add a new explicit
    // occurrence while leaving the shared defaults block intact.
    const items = parseFixture('irregular-instances')
    const existing = occOn(items, '2026-04-15')
    const next = applyEdit(items, existing, 'add', editFields(existing, {
      scheduled: { date: '2026-07-10', time: '10:00' },
      title: 'Project Review',
    }))
    expect(serialize(next)).toMatchSnapshot()
  })

  // ── mixed series + standalones ────────────────────────────────────────────────

  it('excludeOccurrence on a series in a mixed file leaves other series and standalone intact', () => {
    const items = parseFixture('mixed-series-standalones')
    // 2026-04-08 is the generated occurrence of the weekly series
    const occ = occOn(items, '2026-04-08')
    const next = excludeOccurrence(items, occ)
    const yaml = serialize(next)
    expect(yaml).toMatchSnapshot()
    // the friday series must still be present
    expect(yaml).toContain('fr')
    // the standalone multi-day event must still be present
    expect(yaml).toContain('2026-07-01')
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
