import { describe, it, expect } from 'vitest'
import { fixtureNames, parseFixture, serialize, normalizeIds } from './helpers'
import { parseToStoreItems } from '../storeItems'
import { expandRange, multidayCoversDate } from '../expansion'
import { isSeries } from '../../types'

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
    const overrides = items.filter(i => !isSeries(i))
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

  it('keeps the markdown body attached to the first item', () => {
    const items = parseFixture('weekly-series')
    const body = items.find(i => isSeries(i))?.metadata.body ?? ''
    expect(body).toContain('[[project-alpha]] status')
  })

  it('multiday emits a single occurrence; span is inferred via multidayCoversDate', () => {
    const items = parseFixture('multiday')
    expect(items[0].metadata.duration).toBe('3d')

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

  it('both series inherit shared metadata from the file root', () => {
    const items = parseFixture('split-series')
    const series = items.filter(isSeries)
    for (const s of series) {
      expect(s.metadata.title).toBe('Daily Check-in')
      expect(s.metadata.done).toBe(false)
      expect(s.metadata.tags).toEqual(['work'])
    }
  })

  it('each series has one override with done: true', () => {
    const items = parseFixture('split-series')
    const overrides = items.filter(i => !isSeries(i))
    expect(overrides).toHaveLength(2)
    for (const o of overrides) expect(o.metadata.done).toBe(true)
  })
})

describe('task-to-event', () => {
  it('series has no done field; the one override instance retains done: true', () => {
    const items = parseFixture('task-to-event')
    const series = items.filter(isSeries)
    const overrides = items.filter(i => !isSeries(i))
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
    expect(items).toHaveLength(3)
  })

  it('all instances inherit title, tags and duration from the file defaults', () => {
    const items = parseFixture('irregular-instances')
    for (const item of items) {
      expect(item.metadata.title).toBe('Project Review')
      expect(item.metadata.tags).toEqual(['work'])
      expect(item.metadata.duration).toBe('1h')
    }
  })

  it('instances are on the correct dates', () => {
    const items = parseFixture('irregular-instances')
    expect(items.map(i => i.date).sort()).toEqual(['2026-04-15', '2026-05-20', '2026-06-18'])
  })
})

describe('mixed series and standalone instances', () => {
  it('parses into two series and one standalone', () => {
    const items = parseFixture('mixed-series-standalones')
    const series = items.filter(isSeries)
    const standalones = items.filter(i => !isSeries(i) && !(i as { ownerId?: string }).ownerId)
    expect(series).toHaveLength(2)
    expect(standalones).toHaveLength(1)
  })

  it('series have different repeat patterns', () => {
    const items = parseFixture('mixed-series-standalones')
    const series = items.filter(isSeries)
    const types = series.map(s => s.repeat.type).sort()
    expect(types).toEqual(['schedule', 'schedule'])
    const freqs = series.map(s => (s.repeat as { freq?: string }).freq).sort()
    expect(freqs).toEqual(['monthly', 'weekly'])
  })

  it('standalone has no ownerId and is a multi-day event', () => {
    const items = parseFixture('mixed-series-standalones')
    const standalone = items.find(i => !isSeries(i) && !(i as { ownerId?: string }).ownerId)!
    expect(standalone.metadata.title).toBe('Planning Offsite')
    expect(standalone.metadata.duration).toBe('2d')
  })

  it('all items share tags from the file root defaults', () => {
    const items = parseFixture('mixed-series-standalones')
    for (const item of items) {
      expect(item.metadata.tags).toEqual(['work'])
    }
  })
})

describe('YAML scalar handling', () => {
  // YAML 1.2 core schema (used by the `yaml` package) treats bare dates as
  // strings, not timestamps. The app stores `date` as a string everywhere, so
  // this invariant must hold regardless of quoting in the source file.
  it('parses dates as strings, not Date objects', () => {
    const quoted = parseToStoreItems('q.md', '---\ntitle: A\ndate: "2026-04-08"\n---\n')
    const bare = parseToStoreItems('b.md', '---\ntitle: A\ndate: 2026-04-08\n---\n')
    expect(typeof quoted[0].date).toBe('string')
    expect(quoted[0].date).toBe('2026-04-08')
    expect(typeof bare[0].date).toBe('string')
    expect(bare[0].date).toBe('2026-04-08')
  })

  it('round-trips titles that need quoting', () => {
    const src = '---\ntitle: "1:1 with Alex"\ndate: "2026-05-13"\n---\n'
    const items = parseToStoreItems('x.md', src)
    expect(items[0].metadata.title).toBe('1:1 with Alex')
    const reparsed = parseToStoreItems('x.md', serialize(items))
    expect(reparsed[0].metadata.title).toBe('1:1 with Alex')
  })
})
