import { describe, it, expect } from 'vitest'
import { parseFixture, serialize, rootMeta, collectUndated } from './helpers'
import { applyEdit, toggleDone, excludeOccurrence, deleteFollowing, deletionEndsAfterCompletionSeries } from '@/model/storeOps'
import type { EditFields, StoreData } from '@/model/storeOps'
import { parseToStoreItems } from '@/model/storeItems'
import { expandRange } from '@/model/expansion'
import { isSeries } from '@/types'
import type { Occurrence, Roots, StoreItem } from '@/types'

/** Build a StoreData from a ParseResult (single-file fixture). */
function fixtureData(name: string): StoreData {
  const parsed = parseFixture(name)
  return { items: parsed.items, roots: new Map([[name, parsed.root]]) }
}

/** Expand items and return the occurrence on `dateISO`. */
function occOn(items: StoreItem[], roots: Roots, dateISO: string): Occurrence {
  const occs = expandRange(items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
  const occ = occs.find(o => o.date === dateISO)
  if (!occ) throw new Error(`no occurrence on ${dateISO} (have: ${occs.map(o => o.date).join(', ')})`)
  return occ
}

/** Serialize a StoreData back to file content. */
function serializeData(data: StoreData): string {
  const root = [...data.roots.values()][0]
  return serialize(data.items, root)
}

/** Build EditFields from an occurrence, overriding only what a scenario changes. */
function editFields(occ: Occurrence, over: Partial<EditFields> = {}): EditFields {
  const m = occ.metadata
  return {
    title:        m.title,
    tags:         m.tags,
    items:        m.items,
    participants: m.participants,
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
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = toggleDone(data, occ)
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('single-scope edit overrides one occurrence (priority) without touching the series', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'single', editFields(occ, { priority: 'high' }))
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('all-scope edit updates the whole series', () => {
    // The two overridden instances must NOT carry `duration: 30m` here. Until
    // finding #2b was fixed this snapshot recorded exactly that — the old value
    // re-materialised onto every override — which is what "all events" failing
    // to reach an overridden occurrence looks like on disk. They keep only their
    // genuine divergence (`done: true`).
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      duration: '45m',
      title: 'Team Standup',
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    expect(serializeData(next)).toMatchSnapshot()
  })

  // ── finding #2a: clearing an inherited field must survive a reload ─────────
  //
  // The store distinguishes "cleared" from "not set" for both fields below
  // (`[]` vs `undefined`; `undefined` vs the inherited `false`). Collapse used
  // to flatten that distinction on the way out — `inlineFieldEmpty` asked "is
  // this empty?" when the question is "would omitting it lose information?" —
  // so the instance emitted nothing and the next parse re-inherited the old
  // value. Both assert through a full save + reparse, since the store looked
  // correct the whole time and only a reload exposed the loss.

  it('single-scope clearing participants survives a save + reload', () => {
    // Built inline rather than from `weekly-series`: that fixture has no
    // `participants` at all, so every occurrence already holds the `[]` default
    // and "clearing" it is a no-op that passes with or without the fix. The
    // bug only exists where there is a non-empty inherited value to diverge from.
    const src = [
      '---',
      'title: Team Standup',
      'date: 2026-04-06',
      'time: "09:00"',
      'participants: [alice, bob]',
      'repeat:', '  type: schedule', '  freq: weekly', '  byweekday: [mo]',
      'defaults:', '  done: false',
      'instances:', '  - date: 2026-04-13', '    done: true',
      '---',
    ].join('\n')
    const p = parseToStoreItems('ts.md', src)
    const roots = new Map([['ts', p.root]])
    const occ = occOn(p.items, roots, '2026-04-20')
    expect(occ.metadata.participants).toEqual(['alice', 'bob'])   // inherited, not its own

    const next = applyEdit({ items: p.items, roots }, occ, 'single', editFields(occ, {
      participants: [],
      scheduled: { date: '2026-04-20', time: '09:00' },
    }))

    const reparsed = parseToStoreItems('ts.md', serialize(next.items, next.roots.get('ts')))
    const after = expandRange(reparsed.items, new Map([['ts', reparsed.root]]),
      new Date('2026-01-01'), new Date('2026-12-31'))
    expect(after.find(o => o.date === '2026-04-20')!.metadata.participants).toEqual([])
    // …and only that occurrence: every sibling keeps the inherited list.
    expect(after.find(o => o.date === '2026-04-27')!.metadata.participants).toEqual(['alice', 'bob'])
  })

  it('single-scope untracking one occurrence survives a save + reload', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    expect(occ.metadata.done).toBe(false)   // the series makes every occurrence a task

    const next = applyEdit(data, occ, 'single', editFields(occ, {
      tracked: false,
      scheduled: { date: '2026-04-20', time: '09:00' },
    }))

    const reparsed = parseToStoreItems('weekly-series.md', serializeData(next))
    const roots = new Map([['weekly-series', reparsed.root]])
    const after = expandRange(reparsed.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))
    // Untracked: not a task at all, rather than a task that is merely not done.
    expect(after.find(o => o.date === '2026-04-20')!.metadata.done).toBeUndefined()
    expect(after.find(o => o.date === '2026-04-27')!.metadata.done).toBe(false)
  })

  it('a node that inherits nothing still omits an empty field rather than writing it', () => {
    // Passes before AND after the fix — not a regression test, a guard against
    // it OVER-reaching, which is its plausible failure mode. Emitting a cleared
    // value is only correct where the node HAS a baseline to diverge from;
    // loosening the rule everywhere would sprout `participants: []` on every
    // file in every vault. A flat standalone inherits nothing, so an empty list
    // there is still just absent.
    const data = fixtureData('standalone-task')
    const occ = occOn(data.items, data.roots, '2026-04-09')
    const next = applyEdit(data, occ, 'all', editFields(occ, { participants: [] }))
    expect(serializeData(next)).not.toMatch(/participants:/)
  })

  // ── finding #2b: "all events" must reach overridden occurrences ────────────

  it('all-scope reaches an occurrence the user had already overridden', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      duration: '45m',
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    // Survives a save + reload, which is where the old behaviour showed up.
    const reparsed = parseToStoreItems('weekly-series.md', serializeData(next))
    const roots = new Map([['weekly-series', reparsed.root]])
    const durations = expandRange(reparsed.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))
      .map(o => o.metadata.duration)
    expect(new Set(durations)).toEqual(new Set(['45m']))
  })

  it('all-scope does not un-complete an occurrence it reaches', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      duration: '45m',
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    const reparsed = parseToStoreItems('weekly-series.md', serializeData(next))
    const roots = new Map([['weekly-series', reparsed.root]])
    const done = expandRange(reparsed.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))
      .filter(o => o.metadata.done)
      .map(o => o.date)
    expect(done).toEqual(['2026-04-13', '2026-04-14'])
  })

  it('all-scope leaves an override\'s own unknown key alone', () => {
    // `owner: bob` diverges from the series' `owner: alice`; an edit that never
    // mentioned `owner` must not flatten it (an edit never mints unknown keys).
    const data = fixtureData('unknown-keys-series')
    const occ = occOn(data.items, data.roots, '2026-04-13')
    const next = applyEdit(data, occ, 'all', editFields(occ, { duration: '45m' }))
    const override = next.items.find(i => !isSeries(i) && i.date === '2026-04-20')!
    expect(override.metadata.extra?.owner).toBe('bob')
  })

  it('future-scope reaches overridden occurrences in the range it splits off', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-13')
    const next = applyEdit(data, occ, 'future', editFields(occ, {
      duration: '45m',
      scheduled: { date: '2026-04-13', time: '09:00' },
    }))
    // 04-13 and 04-14 are overrides at/after the cut — they move to the new
    // series and must take its metadata, not the old series' 30m.
    const moved = next.items.filter(i => !isSeries(i) && i.date >= '2026-04-13')
    expect(moved.map(i => i.metadata.duration)).toEqual(['45m', '45m'])
    expect(moved.map(i => i.metadata.done)).toEqual([true, true])
  })

  it('future-scope edit splits the series at the occurrence date', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'future', editFields(occ, { duration: '15m' }))
    // Two series for the same file: capped original + new split.
    expect(next.items.filter(isSeries)).toHaveLength(2)
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('excludeOccurrence drops a single generated occurrence', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = excludeOccurrence(data, occ)
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('deletionEndsAfterCompletionSeries is true for the series\' only open occurrence', () => {
    const data = fixtureData('after-completion')
    const occ = occOn(data.items, data.roots, '2026-05-14')
    expect(deletionEndsAfterCompletionSeries(data.items, occ)).toBe(true)
  })

  it('deletionEndsAfterCompletionSeries is false for a done occurrence', () => {
    const data = fixtureData('after-completion')
    const occ = occOn(data.items, data.roots, '2026-05-11')
    expect(deletionEndsAfterCompletionSeries(data.items, occ)).toBe(false)
  })

  it('deletionEndsAfterCompletionSeries is false for a schedule-type series', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    expect(deletionEndsAfterCompletionSeries(data.items, occ)).toBe(false)
  })

  it('deleteFollowing caps the series end before the occurrence', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = deleteFollowing(data, occ)
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('single-scope move excludes the original slot and re-adds at the new date', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'single', editFields(occ, {
      scheduled: { date: '2026-04-22', time: '09:00' },
    }))
    const dates = expandRange(next.items, next.roots, new Date('2026-04-19'), new Date('2026-04-23'))
      .map(o => o.date)
    // Original generated slot suppressed, moved occurrence present.
    expect(dates).toContain('2026-04-22')
    expect(dates).not.toContain('2026-04-20')
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('moving an occurrence back to its original date un-hides it', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const moved = applyEdit(data, occ, 'single', editFields(occ, {
      scheduled: { date: '2026-04-22', time: '09:00' },
    }))
    const movedOcc = occOn(moved.items, moved.roots, '2026-04-22')
    const back = applyEdit(moved, movedOcc, 'single', editFields(movedOcc, {
      scheduled: { date: '2026-04-20', time: '09:00' },
    }))
    const dates = expandRange(back.items, back.roots, new Date('2026-04-19'), new Date('2026-04-23'))
      .map(o => o.date)
    expect(dates).toContain('2026-04-20')
    expect(dates).not.toContain('2026-04-22')
    // No stray excluded stub left behind.
    expect(back.items.filter(i => !isSeries(i) && (i as { excluded?: boolean }).excluded)).toHaveLength(0)
    expect(serializeData(back)).toMatchSnapshot()
  })

  it('moving an occurrence onto a date excluded for an unrelated reason un-hides that date', () => {
    const data = fixtureData('weekly-series')
    const excludedOcc = occOn(data.items, data.roots, '2026-04-27')
    const withExclusion = excludeOccurrence(data, excludedOcc)
    const occ = occOn(withExclusion.items, withExclusion.roots, '2026-04-20')
    const next = applyEdit(withExclusion, occ, 'single', editFields(occ, {
      scheduled: { date: '2026-04-27', time: '09:00' },
    }))
    const dates = expandRange(next.items, next.roots, new Date('2026-04-19'), new Date('2026-04-28'))
      .map(o => o.date)
    expect(dates).toContain('2026-04-27')
    expect(dates).not.toContain('2026-04-20')
    expect(serializeData(next)).toMatchSnapshot()
  })

  // ── split-series ────────────────────────────────────────────────────────────

  it('toggleDone on generated occurrence from the after_completion series targets series2', () => {
    // The split-series fixture has two series: schedule (capped Apr 1–9) and
    // after_completion (from Apr 10). Toggling a generated occurrence from
    // the second series must add an override with ownerId pointing to series2,
    // not series1, and serialize only that override into the file.
    const data = fixtureData('split-series')
    // The after_completion series starts Apr 10 (done:true via override).
    // Its next generated occurrence is Apr 12 (interval: 2 days from Apr 10).
    const occ = occOn(data.items, data.roots, '2026-04-12')
    expect(occ.metadata.done).toBe(false)  // generated, not yet done
    const next = toggleDone(data, occ)
    expect(serializeData(next)).toMatchSnapshot()
  })

  // ── task-to-event ────────────────────────────────────────────────────────────

  it('all-scope edit on an event series preserves the absence of done', () => {
    // Editing "all" on a series that has no `done` (was converted from task to
    // event) must not re-introduce done into the serialized output.
    const data = fixtureData('task-to-event')
    const occ = occOn(data.items, data.roots, '2026-05-07')   // a generated occurrence (no override)
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      scheduled: { date: '2026-05-01', time: '14:00' },  // keep series root date
      title: 'Team Meeting (renamed)',
    }))
    const yaml = serializeData(next)
    expect(yaml).toMatchSnapshot()
    // The series itself is an event — `done` must not appear in the defaults: block.
    const defaultsBlock = yaml.slice(yaml.indexOf('defaults:'), yaml.indexOf('instances:'))
    expect(defaultsBlock).not.toMatch(/\bdone\b/)
  })

  // ── irregular instances ──────────────────────────────────────────────────────

  it('adding a new occurrence to an irregular-instances file keeps shared defaults', () => {
    const data = fixtureData('irregular-instances')
    const existing = occOn(data.items, data.roots, '2026-04-15')
    const next = applyEdit(data, existing, 'add', editFields(existing, {
      scheduled: { date: '2026-07-10', time: '10:00' },
      title: 'Project Review',
    }))
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('add-scope with a repeat creates a new sibling series, not a bare instance', () => {
    // "Every first AND second Friday": start from a first-Friday series, then add
    // a second-Friday rule via the "Add new occurrence" scope. The repeat must be
    // stored as its own series (collapsed to an instances[] entry with a repeat:
    // block), not dropped onto a plain child instance.
    const firstFriday = `---
title: Test series
date: 2026-07-03
repeat:
  type: schedule
  freq: monthly
  interval: 1
  byweekday:
    - fr
  bysetpos: 1
---
`
    const parsed = parseToStoreItems('test-series.md', firstFriday)
    const data: StoreData = { items: parsed.items, roots: new Map([['test-series', parsed.root]]) }
    const existing = occOn(data.items, data.roots, '2026-07-03')

    const next = applyEdit(data, existing, 'add', editFields(existing, {
      scheduled: { date: '2026-07-10', time: '' },
      repeat: { type: 'schedule', freq: 'monthly', interval: 1, byweekday: ['fr'], bysetpos: 2 },
    }))

    // Two flat sibling series in one file — no child instance carrying the repeat.
    const series = next.items.filter(isSeries)
    expect(series).toHaveLength(2)
    expect(next.items.filter(i => !isSeries(i))).toHaveLength(0)

    // Both rules expand: first Friday (Jul 3) and second Friday (Jul 10).
    const dates = expandRange(next.items, next.roots, new Date('2026-07-01'), new Date('2026-07-31'))
      .map(o => o.date)
    expect(dates).toContain('2026-07-03')
    expect(dates).toContain('2026-07-10')

    // The serialized file keeps both repeat blocks (bysetpos 1 and 2).
    const yaml = serializeData(next)
    expect(yaml).toContain('bysetpos: 1')
    expect(yaml).toContain('bysetpos: 2')
    expect(yaml).toMatchSnapshot()
  })

  it('adding a new instance to a done task initializes the new instance as not done', () => {
    const data = fixtureData('standalone-task')
    const existing = occOn(data.items, data.roots, '2026-04-09')
    expect(existing.metadata.done).toBe(true)
    const next = applyEdit(data, existing, 'add', editFields(existing, {
      scheduled: { date: '2026-05-01', time: '' },
    }))
    const occs = expandRange(next.items, next.roots, new Date('2026-01-01'), new Date('2026-12-31'))
    const newOcc = occs.find(o => o.date === '2026-05-01')
    expect(newOcc).toBeDefined()
    expect(newOcc!.metadata.done).toBe(false)
  })

  // ── mixed series + standalones ────────────────────────────────────────────────

  it('excludeOccurrence on a series in a mixed file leaves other series and standalone intact', () => {
    const data = fixtureData('mixed-series-standalones')
    const occ = occOn(data.items, data.roots, '2026-04-08')
    const next = excludeOccurrence(data, occ)
    const yaml = serializeData(next)
    expect(yaml).toMatchSnapshot()
    // the friday series must still be present
    expect(yaml).toContain('fr')
    // the standalone multi-day event must still be present
    expect(yaml).toContain('2026-07-01')
  })

  it('creating a new standalone task serializes to a single file', () => {
    const emptyData: StoreData = { items: [], roots: new Map() }
    const next = applyEdit(emptyData, null, 'all', {
      title: 'Buy groceries',
      tags: ['errand'],
      items: [],
      participants: [],
      body: 'Milk, eggs, bread',
      tracked: true,
      done: false,
      priority: 'medium',
      scheduled: { date: '2026-06-05', time: '' },
      duration: '',
      repeat: null,
    })
    expect(serializeData(next)).toMatchSnapshot()
  })

  it('committing a "new entry" create twice for the same draft upserts instead of duplicating', () => {
    // Regression test: a brand-new item's first save can be followed by a second
    // create-scoped commit before the caller has adopted the item it just
    // created (e.g. a debounced body autosave firing right after an in-dialog
    // metadata save already created the file). Without the draft id to recognise
    // the re-run by, applyNew would append a second item, producing either a
    // silent duplicate `instances[]` entry or a stray second file.
    const emptyData: StoreData = { items: [], roots: new Map() }
    const fields: EditFields = {
      title: 'Board game night',
      tags: [], items: [], participants: [],
      body: '', tracked: false, done: false, priority: null,
      scheduled: { date: '2026-06-05', time: '19:00' },
      duration: '', repeat: null,
    }
    const draftId = 'draft-1'
    const afterFirst = applyEdit(emptyData, null, 'all', fields, draftId)
    expect(afterFirst.items).toHaveLength(1)
    expect(afterFirst.items[0]!.id).toBe(draftId)

    const afterSecond = applyEdit(afterFirst, null, 'all', { ...fields, duration: '1 hour' }, draftId)
    expect(afterSecond.items).toHaveLength(1)
    expect(afterSecond.items[0]!.metadata.duration).toBe('1 hour')
    expect([...afterSecond.roots.keys()]).toEqual(['board-game-night'])
  })

  it('a draft that has already created its file keeps it when the title is retyped', () => {
    // The editor saves as the user types, so the file is created from a partial
    // title. Renaming happens inside that file — the draft must not go allocate a
    // second one once the title grows.
    const emptyData: StoreData = { items: [], roots: new Map() }
    const fields: EditFields = {
      title: 'Board', tags: [], items: [], participants: [],
      body: '', tracked: false, done: false, priority: null,
      scheduled: null, duration: '', repeat: null,
    }
    const draftId = 'draft-1'
    const afterFirst = applyEdit(emptyData, null, 'all', fields, draftId)
    const afterRename = applyEdit(afterFirst, null, 'all', { ...fields, title: 'Board game night' }, draftId)

    expect([...afterRename.roots.keys()]).toEqual(['board'])
    expect(afterRename.roots.get('board')!.title).toBe('Board game night')
    expect(afterRename.items).toHaveLength(1)
  })

  it('creating an entry on a taken slug does not overwrite the existing file', () => {
    // `titleToSlug` collides freely — "Buy groceries" and "Buy groceries!" both
    // map to `buy-groceries`, as does any pair of titles agreeing in their first
    // 60 slug characters. A file write is a whole-file replace, so adopting the
    // colliding slug would silently destroy an unrelated entry.
    const existing = parseToStoreItems(
      'buy-groceries.md',
      '---\ntitle: Buy groceries\ntags: [errands]\ndone: false\ndate: "2026-04-08"\n---\n\nRemember the bags.',
    )
    const data: StoreData = { items: existing.items, roots: new Map([['buy-groceries', existing.root]]) }

    const next = applyEdit(data, null, 'all', {
      title: 'Buy groceries!',
      tags: [], items: [], participants: [],
      body: 'totally different note',
      tracked: false, done: false, priority: null,
      scheduled: null, duration: '', repeat: null,
    }, 'draft-1')

    const untouched = next.roots.get('buy-groceries')!
    expect(untouched.title).toBe('Buy groceries')
    expect(untouched.tags).toEqual(['errands'])
    expect(untouched.body).toContain('Remember the bags')

    const created = next.roots.get('buy-groceries-2')!
    expect(created.title).toBe('Buy groceries!')
    expect(created.body).toBe('totally different note')
    expect(next.items.filter(i => i.entryKey === 'buy-groceries-2')).toHaveLength(1)
  })

  it('a third colliding title keeps counting up rather than landing on a taken slug', () => {
    const fields = (title: string): EditFields => ({
      title, tags: [], items: [], participants: [], body: '',
      tracked: false, done: false, priority: null,
      scheduled: null, duration: '', repeat: null,
    })
    let data: StoreData = { items: [], roots: new Map() }
    data = applyEdit(data, null, 'all', fields('Q3 review'), 'draft-1')
    data = applyEdit(data, null, 'all', fields('Q3-review'), 'draft-2')
    data = applyEdit(data, null, 'all', fields('Q3 Review!'), 'draft-3')

    expect([...data.roots.keys()]).toEqual(['q3-review', 'q3-review-2', 'q3-review-3'])
    expect(data.items.map(i => i.entryKey).sort()).toEqual(['q3-review', 'q3-review-2', 'q3-review-3'])
  })

  it('a new entry avoids a slug held by items whose file failed to reach roots', () => {
    // roots and items can disagree — a file that fails to parse leaves no root
    // entry. Keying the collision check off roots alone would let a new entry
    // adopt a slug that items still point at.
    const orphan: StoreData = {
      items: [{ date: '2026-04-08', time: null, source: 'explicit', entryKey: 'cafe', id: 'orphan-1', metadata: { participants: [] } }],
      roots: new Map(),
    }
    const next = applyEdit(orphan, null, 'all', {
      title: 'Café', tags: [], items: [], participants: [], body: '',
      tracked: false, done: false, priority: null,
      scheduled: null, duration: '', repeat: null,
    }, 'draft-1')

    expect([...next.roots.keys()]).toEqual(['cafe-2'])
    expect(next.items.find(i => i.id === 'orphan-1')!.entryKey).toBe('cafe')
  })

  it('creating an undated task persists and stays searchable but off the calendar', () => {
    const emptyData: StoreData = { items: [], roots: new Map() }
    const next = applyEdit(emptyData, null, 'all', {
      title: 'Buy milk',
      tags: [], items: [], participants: [], body: '',
      tracked: true, done: false, priority: null,
      scheduled: null, duration: '', repeat: null,
    })
    // A standalone occurrence with an empty date is created.
    const standalone = next.items.find(i => !isSeries(i)) as StoreItem
    expect(standalone.date).toBe('')
    expect(standalone.metadata.done).toBe(false)

    // The serialized file omits the date line entirely (no `date: ""`)…
    const yaml = serializeData(next)
    expect(yaml).not.toContain('date:')
    // …yet it round-trips through reload without being dropped.
    const reloaded = parseToStoreItems('buy-milk.md', yaml)
    const reloadedOcc = reloaded.items.find(i => !isSeries(i)) as StoreItem
    expect(reloadedOcc).toBeDefined()
    expect(reloadedOcc.metadata.done).toBe(false)

    // It never appears in the date-windowed expansion (no date to place it on)…
    const reloadedRoots: Roots = new Map([['buy-milk', reloaded.root]])
    const occs = expandRange(reloaded.items, reloadedRoots, new Date('2026-01-01'), new Date('2026-12-31'))
    expect(occs).toHaveLength(0)
    // …but collectUndated surfaces it with the file-level title joined on.
    const undated = collectUndated(reloaded.items, reloadedRoots)
    expect(undated).toHaveLength(1)
    expect(undated[0]!.metadata.title).toBe('Buy milk')
  })

  // ── File-level identity ──────────────────────────────────────────────────────

  it('single-scope title/tags/items change updates the root, not the override', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'single', editFields(occ, {
      title: 'Team Standup Renamed',
      tags: ['work', 'renamed'],
      items: ['[[project-alpha]]'],
    }))
    // The per-file root carries the new title, tags, and items.
    const root = [...next.roots.values()][0]!
    expect(root.title).toBe('Team Standup Renamed')
    expect(root.tags).toEqual(['work', 'renamed'])
    expect(root.items).toEqual(['[[project-alpha]]'])
    // The override instance must NOT carry title/tags/items in serialized YAML.
    const yaml = serializeData(next)
    const instancesSection = yaml.slice(yaml.indexOf('instances:'))
    expect(instancesSection).not.toMatch(/title:/)
    expect(instancesSection).not.toMatch(/tags:/)
    expect(instancesSection).not.toMatch(/items:/)
  })

  it('done/priority edits in single scope stay per-occurrence, not on the root', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'single', editFields(occ, { priority: 'high', done: true }))
    const series = next.items.filter(isSeries)
    // Series root priority unchanged (was undefined)
    expect(series[0]!.metadata.priority).toBeUndefined()
    // Override carries the priority
    const overrides = next.items.filter(i => !isSeries(i))
    const override = overrides.find(o => o.date === '2026-04-20')
    expect(override?.metadata.priority).toBe('high')
  })

  // ── series root never carries done: true ─────────────────────────────────────

  it('creating a new repeating task initializes the series root with done: false', () => {
    // Even when the editor's done flag is true, a brand-new RepeatPattern must
    // start with done: false — otherwise every generated occurrence inherits
    // done: true (the after_completion poisoning bug).
    const emptyData: StoreData = { items: [], roots: new Map() }
    const next = applyEdit(emptyData, null, 'all', {
      title: 'Take Vitamins',
      tags: ['health'], items: [], participants: [], body: '',
      tracked: true, done: true, priority: null,
      scheduled: { date: '2026-05-10', time: '' },
      duration: '',
      repeat: { type: 'after_completion', interval: '1 day' },
    })
    const series = next.items.filter(isSeries)
    expect(series).toHaveLength(1)
    expect(series[0]!.metadata.done).toBe(false)
  })

  it('all-scope edit on a done occurrence does not poison the series root with done: true', () => {
    // Editing "all" while the current occurrence is done must keep the series
    // root at done: false; per-occurrence completion lives in overrides only.
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      done: true,
      title: 'Weekly Standup',
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    const series = next.items.filter(isSeries)
    expect(series[0]!.metadata.done).toBe(false)
  })

  it('future-scope split keeps the new series root at done: false', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'future', editFields(occ, { done: true }))
    for (const s of next.items.filter(isSeries)) {
      expect(s.metadata.done).not.toBe(true)
    }
  })

  it('items round-trips through parse → serialize', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      title: 'Weekly Standup',
      items: ['[[project-alpha]]', '[[weekly-log]]'],
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    const yaml = serializeData(next)
    // items must appear at root, not in instances
    expect(yaml).toContain('items:')
    expect(yaml).toContain('[[project-alpha]]')
    const instancesSection = yaml.slice(yaml.indexOf('instances:'))
    expect(instancesSection).not.toMatch(/items:/)
  })

  it('file-level fields are emitted at the top-level root, never inside defaults:', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      title: 'Weekly Standup',
      tags: ['work'],
      items: ['[[project-alpha]]'],
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    const yaml = serializeData(next)
    // title/tags/items are top-level keys (no leading whitespace) — Obsidian-visible.
    expect(yaml).toMatch(/^title: Weekly Standup$/m)
    expect(yaml).toMatch(/^tags:$/m)
    expect(yaml).toMatch(/^items:$/m)
    // The defaults: block must NOT contain them.
    const defaultsStart = yaml.indexOf('defaults:')
    if (defaultsStart >= 0) {
      const after = yaml.slice(defaultsStart + 'defaults:'.length)
      const blockEnd = after.search(/\n\S/)
      const defaultsBlock = blockEnd >= 0 ? after.slice(0, blockEnd) : after
      expect(defaultsBlock).not.toMatch(/title:/)
      expect(defaultsBlock).not.toMatch(/tags:/)
      expect(defaultsBlock).not.toMatch(/items:/)
    }
  })

  it('load keeps root as the canonical display title, and the override its own diverged title', () => {
    // A file where an override instance had a different title (legacy data).
    //
    // Before finding #5a was fixed, this test asserted the opposite of its own
    // last line below — that the override's own `title:` gets silently dropped
    // on save ("root wins" by way of deletion). It did not; `title` is a
    // `RESERVED_KEYS` member at BOTH levels, so any non-root node writing it
    // had it filtered out with no bag to land in. Root's title is still the
    // one Meridian treats as canonical for display (`FileMetadata.title` /
    // `AppMetadata.title` via `joinFileMeta` — untouched by this fix, since
    // `OccurrenceMetadata` has no typed `title` field for the override's value
    // to compete with). But the override's own bytes are no longer destroyed:
    // they round-trip as inert extra, exactly like any other unknown key.
    const legacy = `---
defaults:
  title: Original Title
  tags: [work]
  done: false
date: 2026-04-06
time: 09:00
repeat:
  type: schedule
  freq: weekly
  byweekday:
    - mo
instances:
  - date: 2026-04-13
    title: Override Title
    done: true
---
`
    const loaded = parseToStoreItems('legacy.md', legacy)
    // The file-level root holds the canonical title.
    expect(rootMeta(loaded).title).toBe('Original Title')
    // No typed occurrence field competes with it — OccurrenceMetadata has none.
    for (const i of loaded.items) {
      expect((i.metadata as unknown as Record<string, unknown>).title).toBeUndefined()
    }
    // The override's own title is preserved as inert extra — never a typed
    // field, never rendered as a display title anywhere — but no longer bytes
    // the user loses on the first save.
    const override = loaded.items.find(i => !isSeries(i) && i.date === '2026-04-13')!
    expect(override.metadata.extra?.title).toBe('Override Title')

    const yaml = serialize(loaded.items, loaded.root)
    const instancesSection = yaml.slice(yaml.indexOf('instances:'))
    expect(instancesSection).toMatch(/title: Override Title/)
  })
})

// ── unknown-key preservation through the edit path ────────────────────────────
//
// PR1 threaded the `extra` bag through parse → collapse; these guard the edit
// path (storeOps.ts), which rebuilds metadata from scratch at several sites and
// can silently drop the bag if a spread is missing.

describe('unknown keys survive every edit scope', () => {
  it.each(['single', 'future', 'all', 'add'] as const)(
    '%s-scope edit keeps the series\' unknown keys',
    (scope) => {
      const data = fixtureData('unknown-keys-series')
      const occ = occOn(data.items, data.roots, '2026-04-06')
      const next = applyEdit(data, occ, scope, editFields(occ, { duration: '45m' }))
      const reparsed = parseToStoreItems('unknown-keys-series.md', serializeData(next))

      // The file root never owns these keys here — the series root is itself an item.
      expect(reparsed.root.extra).toBeUndefined()
      // owner: alice must still reach every series (original, or both halves of a split).
      for (const s of reparsed.items.filter(isSeries)) {
        expect(s.metadata.extra?.owner).toBe('alice')
      }
    },
  )

  it('single-scope edit on a diverging override keeps its own unknown key ("target wins")', () => {
    const data = fixtureData('unknown-keys-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')  // override carries owner: bob
    expect(occ.metadata.extra?.owner).toBe('bob')
    const next = applyEdit(data, occ, 'single', editFields(occ, { duration: '45m' }))

    const override = next.items.find(i => !isSeries(i) && i.date === '2026-04-20')!
    expect(override.metadata.extra?.owner).toBe('bob')

    const reparsed = parseToStoreItems('unknown-keys-series.md', serializeData(next))
    const reparsedOverride = reparsed.items.find(i => !isSeries(i) && i.date === '2026-04-20')!
    expect(reparsedOverride.metadata.extra?.owner).toBe('bob')
  })

  it('updateRoot keeps a container root\'s unknown key across an edit', () => {
    const data = fixtureData('unknown-keys-container')
    const occ = occOn(data.items, data.roots, '2026-04-06')
    const next = applyEdit(data, occ, 'all', editFields(occ, { duration: '45m' }))
    const root = [...next.roots.values()][0]!
    expect(root.extra).toEqual({ project: 'apollo' })
  })

  it('toggleDone preserves an override\'s unknown key (upsertOverride merge)', () => {
    const data = fixtureData('unknown-keys-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = toggleDone(data, occ)
    const override = next.items.find(i => !isSeries(i) && i.date === '2026-04-20')!
    expect(override.metadata.extra?.owner).toBe('bob')
  })

  it('excludeOccurrence preserves an override\'s unknown key on the store item, AND on save', () => {
    const data = fixtureData('unknown-keys-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = excludeOccurrence(data, occ)
    const override = next.items.find(i => !isSeries(i) && i.date === '2026-04-20')!
    expect(override.metadata.extra?.owner).toBe('bob')
    // Regression guard for finding #3 (data-integrity survey): serializeChildren
    // used to emit only date/time/excluded for an excluded child, silently
    // dropping whatever metadata it carried — un-excluding it would have come
    // back blank. It now diffs the excluded child against the series metadata
    // like any other override.
    expect(serializeData(next)).toContain('owner: bob')
  })

  it('excludeOccurrence keeps an unknown key the occurrence carried, on a fresh exclusion stub', () => {
    // The report's original repro: unlike the case above (an existing override
    // being excluded), this occurrence has no prior override — excludeOccurrence
    // creates the exclusion stub for the first time from a generated slot's
    // inherited metadata plus its own explicit fields.
    const src = [
      '---',
      'title: Standup',
      'date: 2026-04-06',
      'repeat:',
      '  type: schedule',
      '  freq: weekly',
      '  byweekday: [mo]',
      'instances:',
      '  - date: 2026-04-13',
      '    done: true',
      '    minutesUrl: https://example.com/notes/13',
      '---',
    ].join('\n')
    const p = parseToStoreItems('s2.md', src)
    const roots = new Map([['s2', p.root]])
    const occ = occOn(p.items, roots, '2026-04-13')

    const next = excludeOccurrence({ items: p.items, roots }, occ)
    const out = serialize(next.items, next.roots.get('s2'))

    expect(out).toContain('minutesUrl: https://example.com/notes/13')
    expect(out).toContain('done: true')
  })
})

describe('stable occurrence ids', () => {
  it('two standalones in the same file on the same date have distinct ids', () => {
    // Two explicit instances on the same date — the old (entryKey, date) matching
    // would have collapsed them; stable ids keep them distinct.
    // Root has no date so it acts as a container; only the two children are emitted.
    const yaml = `---
title: Multi-event day
instances:
  - date: 2026-06-01
    time: "09:00"
    title: Morning meeting
  - date: 2026-06-01
    time: "14:00"
    title: Afternoon review
`
    const { items, root } = parseToStoreItems('multi-event-day.md', yaml)
    const roots: Roots = new Map([['multi-event-day', root]])
    const occs = expandRange(items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    const sameDay = occs.filter(o => o.date === '2026-06-01')
    expect(sameDay).toHaveLength(2)
    expect(sameDay[0]!.id).not.toBe(sameDay[1]!.id)
  })

  it('editing one standalone leaves the other unchanged', () => {
    const yaml = `---
title: Multi-event day
instances:
  - date: 2026-06-01
    time: "09:00"
    title: Morning meeting
  - date: 2026-06-01
    time: "14:00"
    title: Afternoon review
`
    const { items, root } = parseToStoreItems('multi-event-day.md', yaml)
    const roots: Roots = new Map([['multi-event-day', root]])
    const occs = expandRange(items, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    const morning = occs.find(o => o.date === '2026-06-01' && o.time === '09:00')!
    const afternoon = occs.find(o => o.date === '2026-06-01' && o.time === '14:00')!

    // Toggle done on morning only
    const { items: nextItems } = toggleDone({ items, roots }, morning)
    // Re-expand and check afternoon is untouched
    const nextOccs = expandRange(nextItems, roots, new Date('2026-01-01'), new Date('2026-12-31'))
    const nextAfternoon = nextOccs.find(o => o.id === afternoon.id)
    expect(nextAfternoon?.metadata.done).toBeUndefined()

    // Morning should now be done
    const nextMorning = nextOccs.find(o => o.id === morning.id)
    expect(nextMorning?.metadata.done).toBe(true)
  })

  it('expandRange returns the same id for the same occurrence across re-expansions', () => {
    const yaml = `---
title: Weekly standup
date: 2026-04-06
repeat:
  freq: weekly
`
    const { items, root } = parseToStoreItems('standup.md', yaml)
    const roots: Roots = new Map([['standup', root]])
    const from = new Date('2026-04-01')
    const to   = new Date('2026-04-30')
    const first  = expandRange(items, roots, from, to)
    const second = expandRange(items, roots, from, to)
    expect(first.map(o => o.id)).toEqual(second.map(o => o.id))
  })
})
