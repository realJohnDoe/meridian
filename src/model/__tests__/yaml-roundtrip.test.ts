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
