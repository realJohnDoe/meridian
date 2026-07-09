import { describe, it, expect } from 'vitest'
import { fixtureNames, parseFixture, serialize, normalizeIds, rootMeta, occItems } from './helpers'
import { parseToStoreItems } from '@/model/storeItems'
import { expandRange, expandWithMultiday, multidayCoversDate } from '@/model/expansion'
import { fmtISO } from '@/model/dateUtils'
import { isSeries, isStandaloneOcc } from '@/types'

const names = fixtureNames()

describe('YAML deserialize → serialize round-trip', () => {
  // The canonical (collapsed) form must be a stable fixed point: serializing it,
  // re-parsing, and re-serializing yields byte-identical output. Asserting on the
  // serialized string (not the StoreItem[]) sidesteps the non-deterministic UUIDs
  // assigned during parsing, since IDs never appear in the YAML.
  it.each(names)('%s is a serialization fixed point', (name) => {
    const parsed1 = parseFixture(name)
    const yaml1 = serialize(parsed1.items, parsed1.root)

    const parsed2 = parseToStoreItems(`${name}.md`, yaml1)
    const yaml2 = serialize(parsed2.items, parsed2.root)

    expect(yaml2).toBe(yaml1)
  })

  // Re-parsing the canonical form must reproduce the same store structure
  // (modulo random IDs). This guards against a serializer that drops or mangles
  // fields in a way that survives the string comparison above.
  it.each(names)('%s preserves store structure across a round-trip', (name) => {
    const original = parseFixture(name)
    const reparsed = parseToStoreItems(`${name}.md`, serialize(original.items, original.root))
    expect(normalizeIds(reparsed.items)).toEqual(normalizeIds(original.items))
  })
})

describe('structural expectations', () => {
  it('weekly-series yields one series plus two explicit overrides', () => {
    const parsed = parseFixture('weekly-series')
    const series = parsed.items.filter(isSeries)
    const overrides = parsed.items.filter(i => !isSeries(i))
    expect(series).toHaveLength(1)
    expect(overrides).toHaveLength(2)
    expect(series[0].repeat).toMatchObject({ type: 'schedule', freq: 'weekly', byweekday: ['mo'] })
  })

  it('preserves the after_completion repeat type and interval', () => {
    const parsed = parseFixture('after-completion')
    const series = parsed.items.filter(isSeries)
    expect(series).toHaveLength(1)
    expect(series[0].repeat).toMatchObject({ type: 'after_completion', interval: '1 day' })
  })

  it('keeps the markdown body on the per-file root', () => {
    const parsed = parseFixture('weekly-series')
    expect(rootMeta(parsed).body ?? '').toContain('[[project-alpha]] status')
  })

  it('multiday emits a single occurrence; span is inferred via multidayCoversDate', () => {
    const parsed = parseFixture('multiday')
    const roots = new Map([[`multiday`, parsed.root]])
    expect(occItems(parsed)[0].metadata.duration).toBe('3d')

    // expandRange emits ONE occurrence on the start date — not one per day.
    const occs = expandRange(parsed.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))
    expect(occs).toHaveLength(1)
    expect(occs[0].date).toBe('2026-04-19')

    // multidayCoversDate spans all three days and stops at the boundary.
    expect(multidayCoversDate(occs[0], new Date('2026-04-18'))).toBe(false)
    expect(multidayCoversDate(occs[0], new Date('2026-04-19'))).toBe(true)
    expect(multidayCoversDate(occs[0], new Date('2026-04-20'))).toBe(true)
    expect(multidayCoversDate(occs[0], new Date('2026-04-21'))).toBe(true)
    expect(multidayCoversDate(occs[0], new Date('2026-04-22'))).toBe(false)
  })

  // Regression test: Month/Agenda views expand a whole range at once (unlike
  // Day view, which queries one day at a time), so a multiday event's virtual
  // occurrences for days 2..N must not be deduped away just because they share
  // the start-date occurrence's id.
  it('multiday: expandWithMultiday emits one occurrence per covered day across a range', () => {
    const parsed = parseFixture('multiday')
    const roots = new Map([[`multiday`, parsed.root]])

    const occs = expandWithMultiday(parsed.items, roots, new Date('2026-04-01'), new Date('2026-04-30'))
    const dates = occs.map(o => o.metadata.jsTime && fmtISO(o.metadata.jsTime))
    expect(dates).toEqual(['2026-04-19', '2026-04-20', '2026-04-21'])
  })

  // Regression test: malformed frontmatter (a nested mapping where a scalar
  // was expected) must not silently stringify to '[object Object]' — it
  // should be treated as absent instead.
  it('malformed non-scalar date/title fields are treated as absent, not "[object Object]"', () => {
    const parsed = parseToStoreItems('malformed.md', [
      '---',
      'title:',
      '  nested: yes',
      'date:',
      '  nested: yes',
      '---',
    ].join('\n'))

    expect(parsed.root.title).not.toContain('[object Object]')
    expect(parsed.items[0].date).not.toContain('[object Object]')
  })
})

describe('split series (repeat-type change)', () => {
  it('parses into two separate RepeatPattern items with the same fileSlug', () => {
    const parsed = parseFixture('split-series')
    const series = parsed.items.filter(isSeries)
    expect(series).toHaveLength(2)
    expect(series[0].repeat).toMatchObject({ type: 'schedule', freq: 'daily' })
    expect(series[1].repeat).toMatchObject({ type: 'after_completion' })
    // Both series belong to the same file
    expect(series[0].fileSlug).toBe(series[1].fileSlug)
  })

  it('file-level title/tags live on the root; series keep occurrence fields', () => {
    const parsed = parseFixture('split-series')
    // Title and tags are file-level → on the root, not the series.
    expect(rootMeta(parsed).title).toBe('Daily Check-in')
    expect(rootMeta(parsed).tags).toEqual(['work'])
    // done is an occurrence field → still on each series.
    for (const s of parsed.items.filter(isSeries)) expect(s.metadata.done).toBe(false)
  })

  it('each series has one override with done: true', () => {
    const parsed = parseFixture('split-series')
    const overrides = parsed.items.filter(i => !isSeries(i))
    expect(overrides).toHaveLength(2)
    for (const o of overrides) expect(o.metadata.done).toBe(true)
  })
})

describe('task-to-event', () => {
  it('series has no done field; the one override instance retains done: true', () => {
    const parsed = parseFixture('task-to-event')
    const series = parsed.items.filter(isSeries)
    const overrides = parsed.items.filter(i => !isSeries(i))
    expect(series).toHaveLength(1)
    expect(series[0].metadata.done).toBeUndefined()
    expect(overrides).toHaveLength(1)
    expect(overrides[0].metadata.done).toBe(true)
  })

  it('generates future occurrences that are events (no done)', () => {
    const parsed = parseFixture('task-to-event')
    const roots = new Map([[parsed.items[0]?.fileSlug ?? 'task-to-event', parsed.root]])
    const occs = expandRange(parsed.items, roots, new Date('2026-05-08'), new Date('2026-05-31'))
    // Generated occurrences inherit no `done` from the series
    for (const o of occs) expect(o.metadata.done).toBeUndefined()
  })
})

describe('irregular instances with shared defaults', () => {
  it('parses into three standalone occurrences with no series', () => {
    const parsed = parseFixture('irregular-instances')
    expect(parsed.items.filter(isSeries)).toHaveLength(0)
    expect(occItems(parsed)).toHaveLength(3)
  })

  it('title/tags live on the root; duration stays per occurrence', () => {
    const parsed = parseFixture('irregular-instances')
    expect(rootMeta(parsed).title).toBe('Project Review')
    expect(rootMeta(parsed).tags).toEqual(['work'])
    for (const item of occItems(parsed)) {
      expect(item.metadata.duration).toBe('1h')
    }
  })

  it('instances are on the correct dates', () => {
    const parsed = parseFixture('irregular-instances')
    expect(occItems(parsed).map(i => i.date).sort()).toEqual(['2026-04-15', '2026-05-20', '2026-06-18'])
  })
})

describe('mixed series and standalone instances', () => {
  it('parses into two series and one standalone', () => {
    const parsed = parseFixture('mixed-series-standalones')
    const series = parsed.items.filter(isSeries)
    const standalones = parsed.items.filter(isStandaloneOcc)
    expect(series).toHaveLength(2)
    expect(standalones).toHaveLength(1)
  })

  it('series have different schedules (mo weekly and fr weekly)', () => {
    const parsed = parseFixture('mixed-series-standalones')
    const series = parsed.items.filter(isSeries)
    expect(series).toHaveLength(2)
    const days = series.flatMap(s => (s.repeat as { byweekday?: string[] }).byweekday ?? []).sort()
    expect(days).toEqual(['fr', 'mo'])
    // First series is capped
    expect((series[0].repeat as { end?: unknown }).end).toBeDefined()
  })

  it('standalone has no ownerId; duration stays on it, title on the root', () => {
    const parsed = parseFixture('mixed-series-standalones')
    const standalone = parsed.items.find(i => !isSeries(i) && !(i as { ownerId?: string }).ownerId)!
    expect(rootMeta(parsed).title).toBe('Weekly Sync')
    expect(standalone.metadata.duration).toBe('2d')
  })

  it('file-level title/tags on the root; done shared across items', () => {
    const parsed = parseFixture('mixed-series-standalones')
    expect(rootMeta(parsed).title).toBe('Weekly Sync')
    expect(rootMeta(parsed).tags).toEqual(['work'])
    // done is an occurrence field, still present on each item.
    for (const item of occItems(parsed)) expect(item.metadata.done).toBe(false)
  })
})

describe('YAML scalar handling', () => {
  // YAML 1.2 core schema (used by the `yaml` package) treats bare dates as
  // strings, not timestamps. The app stores `date` as a string everywhere, so
  // this invariant must hold regardless of quoting in the source file.
  it('parses dates as strings, not Date objects', () => {
    const quoted = parseToStoreItems('q.md', '---\ntitle: A\ndate: "2026-04-08"\n---\n')
    const bare = parseToStoreItems('b.md', '---\ntitle: A\ndate: 2026-04-08\n---\n')
    expect(typeof quoted.items[0].date).toBe('string')
    expect(quoted.items[0].date).toBe('2026-04-08')
    expect(typeof bare.items[0].date).toBe('string')
    expect(bare.items[0].date).toBe('2026-04-08')
  })

  it('round-trips titles that need quoting', () => {
    const src = '---\ntitle: "1:1 with Alex"\ndate: "2026-05-13"\n---\n'
    const parsed = parseToStoreItems('x.md', src)
    expect(rootMeta(parsed).title).toBe('1:1 with Alex')
    const reparsed = parseToStoreItems('x.md', serialize(parsed.items, parsed.root))
    expect(rootMeta(reparsed).title).toBe('1:1 with Alex')
  })
})
