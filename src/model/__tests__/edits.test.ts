import { describe, it, expect } from 'vitest'
import { parseFixture, serialize, rootMeta } from './helpers'
import { applyEdit, toggleDone, excludeOccurrence, deleteFollowing } from '../storeOps'
import type { EditFields, StoreData } from '../storeOps'
import { parseToStoreItems } from '../storeItems'
import { expandRange, collectUndated } from '../expansion'
import { isSeries } from '../../types'
import type { Occurrence, Roots, StoreItem } from '../../types'

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
    tags:         m.tags ?? [],
    topics:       m.topics ?? [],
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
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      duration: '45m',
      title: 'Team Standup',
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    expect(serializeData(next)).toMatchSnapshot()
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

  it('deleteFollowing caps the series end before the occurrence', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = deleteFollowing(data, occ)
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
      topics: [],
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

  it('creating an undated task persists and stays searchable but off the calendar', () => {
    const emptyData: StoreData = { items: [], roots: new Map() }
    const next = applyEdit(emptyData, null, 'all', {
      title: 'Buy milk',
      tags: [], topics: [], participants: [], body: '',
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
    expect(undated[0].metadata.title).toBe('Buy milk')
  })

  // ── File-level identity ──────────────────────────────────────────────────────

  it('single-scope title/tags/topics change updates the root, not the override', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'single', editFields(occ, {
      title: 'Team Standup Renamed',
      tags: ['work', 'renamed'],
      topics: ['[[project-alpha]]'],
    }))
    // The per-file root carries the new title, tags, and topics.
    const root = [...next.roots.values()][0]
    expect(root.title).toBe('Team Standup Renamed')
    expect(root.tags).toEqual(['work', 'renamed'])
    expect(root.topics).toEqual(['[[project-alpha]]'])
    // The override instance must NOT carry title/tags/topics in serialized YAML.
    const yaml = serializeData(next)
    const instancesSection = yaml.slice(yaml.indexOf('instances:'))
    expect(instancesSection).not.toMatch(/title:/)
    expect(instancesSection).not.toMatch(/tags:/)
    expect(instancesSection).not.toMatch(/topics:/)
  })

  it('done/priority edits in single scope stay per-occurrence, not on the root', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'single', editFields(occ, { priority: 'high', done: true }))
    const series = next.items.filter(isSeries)
    // Series root priority unchanged (was undefined)
    expect(series[0].metadata.priority).toBeUndefined()
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
      tags: ['health'], topics: [], participants: [], body: '',
      tracked: true, done: true, priority: null,
      scheduled: { date: '2026-05-10', time: '' },
      duration: '',
      repeat: { type: 'after_completion', interval: '1 day' },
    })
    const series = next.items.filter(isSeries)
    expect(series).toHaveLength(1)
    expect(series[0].metadata.done).toBe(false)
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
    expect(series[0].metadata.done).toBe(false)
  })

  it('future-scope split keeps the new series root at done: false', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'future', editFields(occ, { done: true }))
    for (const s of next.items.filter(isSeries)) {
      expect(s.metadata.done).not.toBe(true)
    }
  })

  it('topics round-trips through parse → serialize', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      title: 'Weekly Standup',
      topics: ['[[project-alpha]]', '[[weekly-log]]'],
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    const yaml = serializeData(next)
    // topics must appear at root, not in instances
    expect(yaml).toContain('topics:')
    expect(yaml).toContain('[[project-alpha]]')
    const instancesSection = yaml.slice(yaml.indexOf('instances:'))
    expect(instancesSection).not.toMatch(/topics:/)
  })

  it('file-level fields are emitted at the top-level root, never inside defaults:', () => {
    const data = fixtureData('weekly-series')
    const occ = occOn(data.items, data.roots, '2026-04-20')
    const next = applyEdit(data, occ, 'all', editFields(occ, {
      title: 'Weekly Standup',
      tags: ['work'],
      topics: ['[[project-alpha]]'],
      scheduled: { date: '2026-04-06', time: '09:00' },
    }))
    const yaml = serializeData(next)
    // title/tags/topics are top-level keys (no leading whitespace) — Obsidian-visible.
    expect(yaml).toMatch(/^title: Weekly Standup$/m)
    expect(yaml).toMatch(/^tags:$/m)
    expect(yaml).toMatch(/^topics:$/m)
    // The defaults: block must NOT contain them.
    const defaultsStart = yaml.indexOf('defaults:')
    if (defaultsStart >= 0) {
      const after = yaml.slice(defaultsStart + 'defaults:'.length)
      const blockEnd = after.search(/\n\S/)
      const defaultsBlock = blockEnd >= 0 ? after.slice(0, blockEnd) : after
      expect(defaultsBlock).not.toMatch(/title:/)
      expect(defaultsBlock).not.toMatch(/tags:/)
      expect(defaultsBlock).not.toMatch(/topics:/)
    }
  })

  it('load normalizes a legacy override that diverged title — root wins', () => {
    // Simulate a file where an override instance had a different title (legacy data).
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
    // Raw store items carry only occurrence metadata — no title field.
    for (const i of loaded.items) {
      expect((i.metadata as Record<string, unknown>).title).toBeUndefined()
    }
    // In YAML, title must not appear inside an instance.
    const yaml = serialize(loaded.items, loaded.root)
    const instancesSection = yaml.slice(yaml.indexOf('instances:'))
    expect(instancesSection).not.toMatch(/title:/)
  })
})

describe('stable occurrence ids', () => {
  it('two standalones in the same file on the same date have distinct ids', () => {
    // Two explicit instances on the same date — the old (fileSlug, date) matching
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
    expect(sameDay[0].id).not.toBe(sameDay[1].id)
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
