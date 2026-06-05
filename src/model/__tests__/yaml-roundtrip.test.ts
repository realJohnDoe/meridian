import { describe, it, expect } from 'vitest'
import { fixtureNames, parseFixture, serialize, normalizeIds, rootMeta, occItems } from './helpers'
import { parseToStoreItems } from '../storeItems'
import { expandRange, multidayCoversDate } from '../expansion'
import { isSeries, isRootNode } from '../../types'

const names = fixtureNames()

describe('YAML deserialize → serialize round-trip', () => {
  // The canonical (collapsed) form must be a stable fixed point: serializing it,
  // re-parsing, and re-serializing yields byte-identical output. Asserting on the
  // serialized string (not the StoreItem[]) sidesteps the non-deterministic UUIDs
  // assigned during parsing, since IDs never appear in the YAML.
  it.each(names)('%s is a serialization fixed point', (name) => {
    const items1 = parseFixture(name)
    const yaml1 = serialize(items1)

    const items2 = parseToStoreItems(`${name}.md`, yaml1)
    const yaml2 = serialize(items2)

    expect(yaml2).toBe(yaml1)
  })

  // Re-parsing the canonical form must reproduce the same store structure
  // (modulo random IDs). This guards against a serializer that drops or mangles
  // fields in a way that survives the string comparison above.
  it.each(names)('%s preserves store structure across a round-trip', (name) => {
    const original = parseFixture(name)
    const reparsed = parseToStoreItems(`${name}.md`, serialize(original))
    expect(normalizeIds(reparsed)).toEqual(normalizeIds(original))
  })
})

describe('structural expectations', () => {
  it('weekly-series yields one series plus two explicit overrides', () => {
    const items = parseFixture('weekly-series')
    const series = items.filter(isSeries)
    const overrides = items.filter(i => !isSeries(i) && !isRootNode(i))
    expect(series).toHaveLength(1)
    expect(overrides).toHaveLength(2)
    expect(series[0].repeat).toMatchObject({ type: 'schedule', freq: 'weekly', byweekday: ['mo'] })
  })

  it('preserves the after_completion repeat type and interval', () => {
    const items = parseFixture('after-completion')
    const series = items.filter(isSeries)
    expect(series).toHaveLength(1)
    expect(series[0].repeat).toMatchObject({ type: 'after_completion', interval: '1 day' })
  })

  it('keeps the markdown body on the per-file root node', () => {
    const items = parseFixture('weekly-series')
    expect(rootMeta(items)?.body ?? '').toContain('[[project-alpha]] status')
  })

  it('multiday emits a single occurrence; span is inferred via multidayCoversDate', () => {
    const items = parseFixture('multiday')
    expect(occItems(items)[0].metadata.duration).toBe('3d')

    // expandRange emits ONE occurrence on the start date — not one per day.
    const occs = expandRange(items, new Date('2026-04-01'), new Date('2026-04-30'))
    expect(occs).toHaveLength(1)
    expect(occs[0].date).toBe('2026-04-19')

    // multidayCoversDate spans all three days and stops at the boundary.
    expect(multidayCoversDate(occs[0], new Date('2026-04-18'))).toBe(false)
    expect(multidayCoversDate(occs[0], new Date('2026-04-19'))).toBe(true)
    expect(multidayCoversDate(occs[0], new Date('2026-04-20'))).toBe(true)
    expect(multidayCoversDate(occs[0], new Date('2026-04-21'))).toBe(true)
    expect(multidayCoversDate(occs[0], new Date('2026-04-22'))).toBe(false)
  })
})

describe('split series (repeat-type change)', () => {
  it('parses into two separate RepeatPattern items with the same fileSlug', () => {
    const items = parseFixture('split-series')
    const series = items.filter(isSeries)
    expect(series).toHaveLength(2)
    expect(series[0].repeat).toMatchObject({ type: 'schedule', freq: 'daily' })
    expect(series[1].repeat).toMatchObject({ type: 'after_completion' })
    // Both series belong to the same file
    expect(series[0].fileSlug).toBe(series[1].fileSlug)
  })

  it('file-level title/tags live on the root node; series keep occurrence fields', () => {
    const items = parseFixture('split-series')
    // Title and tags are file-level → on the root node, not the series.
    expect(rootMeta(items)?.title).toBe('Daily Check-in')
    expect(rootMeta(items)?.tags).toEqual(['work'])
    // done is an occurrence field → still on each series.
    for (const s of items.filter(isSeries)) expect(s.metadata.done).toBe(false)
  })

  it('each series has one override with done: true', () => {
    const items = parseFixture('split-series')
    const overrides = items.filter(i => !isSeries(i) && !isRootNode(i))
    expect(overrides).toHaveLength(2)
    for (const o of overrides) expect(o.metadata.done).toBe(true)
  })
})

describe('task-to-event', () => {
  it('series has no done field; the one override instance retains done: true', () => {
    const items = parseFixture('task-to-event')
    const series = items.filter(isSeries)
    const overrides = items.filter(i => !isSeries(i) && !isRootNode(i))
    expect(series).toHaveLength(1)
    expect(series[0].metadata.done).toBeUndefined()
    expect(overrides).toHaveLength(1)
    expect(overrides[0].metadata.done).toBe(true)
  })

  it('generates future occurrences that are events (no done)', () => {
    const items = parseFixture('task-to-event')
    const occs = expandRange(items, new Date('2026-05-08'), new Date('2026-05-31'))
    // Generated occurrences inherit no `done` from the series
    for (const o of occs) expect(o.metadata.done).toBeUndefined()
  })
})

describe('irregular instances with shared defaults', () => {
  it('parses into three standalone occurrences with no series', () => {
    const items = parseFixture('irregular-instances')
    expect(items.filter(isSeries)).toHaveLength(0)
    expect(occItems(items)).toHaveLength(3)
  })

  it('title/tags live on the root node; duration stays per occurrence', () => {
    const items = parseFixture('irregular-instances')
    expect(rootMeta(items)?.title).toBe('Project Review')
    expect(rootMeta(items)?.tags).toEqual(['work'])
    for (const item of occItems(items)) {
      expect(item.metadata.duration).toBe('1h')
    }
  })

  it('instances are on the correct dates', () => {
    const items = parseFixture('irregular-instances')
    expect(occItems(items).map(i => i.date).sort()).toEqual(['2026-04-15', '2026-05-20', '2026-06-18'])
  })
})

describe('mixed series and standalone instances', () => {
  it('parses into two series and one standalone', () => {
    const items = parseFixture('mixed-series-standalones')
    const series = items.filter(isSeries)
    const standalones = items.filter(i => !isSeries(i) && !isRootNode(i) && !(i as { ownerId?: string }).ownerId)
    expect(series).toHaveLength(2)
    expect(standalones).toHaveLength(1)
  })

  it('series have different schedules (mo weekly and fr weekly)', () => {
    const items = parseFixture('mixed-series-standalones')
    const series = items.filter(isSeries)
    expect(series).toHaveLength(2)
    const days = series.flatMap(s => (s.repeat as { byweekday?: string[] }).byweekday ?? []).sort()
    expect(days).toEqual(['fr', 'mo'])
    // First series is capped
    expect((series[0].repeat as { end?: unknown }).end).toBeDefined()
  })

  it('standalone has no ownerId; duration stays on it, title on the root node', () => {
    const items = parseFixture('mixed-series-standalones')
    const standalone = items.find(i => !isSeries(i) && !isRootNode(i) && !(i as { ownerId?: string }).ownerId)!
    expect(rootMeta(items)?.title).toBe('Weekly Sync')
    expect(standalone.metadata.duration).toBe('2d')
  })

  it('file-level title/tags on the root node; done shared across items', () => {
    const items = parseFixture('mixed-series-standalones')
    expect(rootMeta(items)?.title).toBe('Weekly Sync')
    expect(rootMeta(items)?.tags).toEqual(['work'])
    // done is an occurrence field, still present on each non-root item.
    for (const item of occItems(items)) expect(item.metadata.done).toBe(false)
  })
})

describe('YAML scalar handling', () => {
  // YAML 1.2 core schema (used by the `yaml` package) treats bare dates as
  // strings, not timestamps. The app stores `date` as a string everywhere, so
  // this invariant must hold regardless of quoting in the source file.
  it('parses dates as strings, not Date objects', () => {
    const quoted = occItems(parseToStoreItems('q.md', '---\ntitle: A\ndate: "2026-04-08"\n---\n'))
    const bare = occItems(parseToStoreItems('b.md', '---\ntitle: A\ndate: 2026-04-08\n---\n'))
    expect(typeof quoted[0].date).toBe('string')
    expect(quoted[0].date).toBe('2026-04-08')
    expect(typeof bare[0].date).toBe('string')
    expect(bare[0].date).toBe('2026-04-08')
  })

  it('round-trips titles that need quoting', () => {
    const src = '---\ntitle: "1:1 with Alex"\ndate: "2026-05-13"\n---\n'
    const items = parseToStoreItems('x.md', src)
    expect(rootMeta(items)?.title).toBe('1:1 with Alex')
    const reparsed = parseToStoreItems('x.md', serialize(items))
    expect(rootMeta(reparsed)?.title).toBe('1:1 with Alex')
  })
})
