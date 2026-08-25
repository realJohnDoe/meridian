import { describe, it, expect } from 'vitest'
import { entriesToIcs } from './entriesToIcs'
import { parseIcs, components, propValue, prop, param, textValue, props } from './icsParse'
import { icsToEntries } from './icsToEntries'
import { entryKey } from '@/fileIO'
import type { Entry, FileMetadata, StoreOcc, StoreSeries } from '@/types'

// Built via Date.UTC so DTSTAMP's expected value doesn't depend on the runner's zone.
const NOW = new Date(Date.UTC(2026, 7, 15, 12, 0, 0)) // 2026-08-15T12:00:00Z

const KEY = entryKey('vault-1', 'meeting')

function root(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return { title: 'Weekly sync', tags: [], items: [], vaultId: 'vault-1', fileSlug: 'meeting', ...overrides }
}

function entry(items: Entry['items'], overrides: Partial<FileMetadata> = {}): Entry {
  return { key: KEY, root: root(overrides), items }
}

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-08-17',
    time: '09:00',
    repeat: { type: 'schedule', freq: 'weekly', byweekday: ['mo'] },
    entryKey: KEY,
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

function occ(overrides: Partial<StoreOcc> = {}): StoreOcc {
  return {
    date: '2026-08-17', time: '09:00', source: 'explicit', entryKey: KEY,
    id: 'occ-1', metadata: { participants: [] }, ...overrides,
  }
}

/** The single VEVENT (or nth) a document produces, decoded back to a property lookup. */
function events(ics: string) {
  const cal = parseIcs(ics)
  if (!cal) throw new Error(`not a calendar:\n${ics}`)
  return components(cal, 'VEVENT')
}

describe('entriesToIcs — framing', () => {
  it('wraps in a valid VCALENDAR with CRLF line endings', () => {
    const ics = entriesToIcs([], NOW)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics).toContain('VERSION:2.0')
    expect(parseIcs(ics)).not.toBeNull()
  })

  it('emits nothing for an empty entry list', () => {
    expect(events(entriesToIcs([], NOW))).toHaveLength(0)
  })
})

describe('entriesToIcs — a standalone occurrence', () => {
  it('emits DTSTART/SUMMARY/DTSTAMP as floating values, no TZID or Z', () => {
    const ics = entriesToIcs([entry([occ()])], NOW)
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    expect(propValue(ev, 'DTSTART')).toBe('20260817T090000')
    expect(param(prop(ev, 'DTSTART')!, 'TZID')).toBeUndefined()
    expect(textValue(ev, 'SUMMARY')).toBe('Weekly sync')
    expect(propValue(ev, 'DTSTAMP')).toBe('20260815T120000Z') // DTSTAMP is the one UTC exception
  })

  it('emits an all-day VALUE=DATE for a timeless occurrence', () => {
    const ics = entriesToIcs([entry([occ({ time: null })])], NOW)
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    const dtstart = prop(ev, 'DTSTART')!
    expect(dtstart.value).toBe('20260817')
    expect(param(dtstart, 'VALUE')).toBe('DATE')
  })

  it('derives DTEND from the Meridian duration string', () => {
    const ics = entriesToIcs([entry([occ({ metadata: { participants: [], duration: '90 minutes' } })])], NOW)
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    expect(propValue(ev, 'DTEND')).toBe('20260817T103000')
  })

  it('emits a multi-day all-day DTEND as an exclusive day count', () => {
    const ics = entriesToIcs([entry([occ({ time: null, metadata: { participants: [], duration: '3 days' } })])], NOW)
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    expect(propValue(ev, 'DTEND')).toBe('20260820')
  })

  it('omits DTEND when there is no duration', () => {
    const ics = entriesToIcs([entry([occ()])], NOW)
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    expect(propValue(ev, 'DTEND')).toBeUndefined()
  })

  it('escapes commas, semicolons and newlines in TEXT values', () => {
    const ics = entriesToIcs([entry([occ()], { title: 'Lunch, then; talk', body: 'Line one\nLine two' })], NOW)
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    expect(textValue(ev, 'SUMMARY')).toBe('Lunch, then; talk')
    expect(textValue(ev, 'DESCRIPTION')).toBe('Line one\nLine two')
  })

  it('gives sibling standalone occurrences in one file distinct UIDs', () => {
    const a = occ({ id: 'occ-a', date: '2026-08-17' })
    const b = occ({ id: 'occ-b', date: '2026-08-18' })
    const ics = entriesToIcs([entry([a, b])], NOW)
    const [ev1, ev2] = events(ics)
    if (!ev1 || !ev2) throw new Error('expected two VEVENTs')
    expect(propValue(ev1, 'UID')).not.toBe(propValue(ev2, 'UID'))
  })

  it('skips an undated occurrence — nothing for an RRULE-shaped format to place', () => {
    const ics = entriesToIcs([entry([occ({ date: '' })])], NOW)
    expect(events(ics)).toHaveLength(0)
  })
})

describe('entriesToIcs — series', () => {
  it('emits the RRULE repeatToRrule computes for the same repeat + anchor', () => {
    const ics = entriesToIcs([entry([series()])], NOW)
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    expect(propValue(ev, 'RRULE')).toBe('FREQ=WEEKLY;BYDAY=MO')
  })

  it('omits after_completion series entirely — no RRULE equivalent exists', () => {
    const afterCompletion: StoreSeries = {
      date: '2026-08-17', time: '09:00',
      repeat: { type: 'after_completion', interval: '3 days' },
      entryKey: KEY, id: 'series-ac', metadata: { participants: [] },
    }
    const ics = entriesToIcs([entry([afterCompletion])], NOW)
    expect(events(ics)).toHaveLength(0)
  })

  it('turns an excluded override into an EXDATE on the master, with no separate VEVENT', () => {
    const s = series()
    const excluded = occ({ id: 'occ:series-1|2026-08-24|09:00', ownerId: 'series-1', date: '2026-08-24', time: '09:00', excluded: true })
    const ics = entriesToIcs([entry([s, excluded])], NOW)
    const all = events(ics)
    expect(all).toHaveLength(1) // only the master — no VEVENT for an exclusion
    const [master] = all
    if (!master) throw new Error('no VEVENT')
    expect(propValue(master, 'EXDATE')).toBe('20260824T090000')
  })

  it('gives an in-place-edited override a RECURRENCE-ID equal to its own date', () => {
    const s = series()
    // Created at its generated slot and never moved: the id still encodes that same date.
    const edited = occ({ id: 'occ:series-1|2026-08-24|09:00', ownerId: 'series-1', date: '2026-08-24', time: '09:00', metadata: { participants: [], duration: '30 minutes' } })
    const ics = entriesToIcs([entry([s, edited])], NOW)
    const all = events(ics)
    expect(all).toHaveLength(2)
    const override = all[1]
    if (!override) throw new Error('no override VEVENT')
    expect(propValue(override, 'RECURRENCE-ID')).toBe('20260824T090000')
    expect(propValue(override, 'DTSTART')).toBe('20260824T090000')
    expect(propValue(override, 'UID')).toBe(propValue(all[0]!, 'UID')) // shares the master's UID
  })

  it('recovers the ORIGINAL slot for a moved override from its id, not its current date', () => {
    const s = series()
    // Mirrors applySingle's move: id keeps naming the original 08-24 slot; date/time point at the new one.
    const moved = occ({ id: 'occ:series-1|2026-08-24|09:00', ownerId: 'series-1', date: '2026-08-26', time: '14:00' })
    const ics = entriesToIcs([entry([s, moved])], NOW)
    const [, override] = events(ics)
    if (!override) throw new Error('no override VEVENT')
    expect(propValue(override, 'RECURRENCE-ID')).toBe('20260824T090000')
    expect(propValue(override, 'DTSTART')).toBe('20260826T140000')
  })

  it('falls back to the override\'s own date when its id carries no original slot (an added occurrence)', () => {
    const s = series()
    const added = occ({ id: 'freshly-added-uuid', ownerId: 'series-1', date: '2026-09-01', time: '09:00' })
    const ics = entriesToIcs([entry([s, added])], NOW)
    const [, override] = events(ics)
    if (!override) throw new Error('no override VEVENT')
    expect(propValue(override, 'RECURRENCE-ID')).toBe('20260901T090000')
  })

  it('prefers a divergent occurrence-level title over the file root\'s', () => {
    const s = series()
    const retitled = occ({
      id: 'occ:series-1|2026-08-24|09:00', ownerId: 'series-1', date: '2026-08-24', time: '09:00',
      metadata: { participants: [], extra: { title: 'Team offsite' } },
    })
    const ics = entriesToIcs([entry([s, retitled])], NOW)
    const [, override] = events(ics)
    if (!override) throw new Error('no override VEVENT')
    expect(textValue(override, 'SUMMARY')).toBe('Team offsite')
  })
})

describe('entriesToIcs — line folding', () => {
  it('folds a long SUMMARY at 75 octets with a space-prefixed continuation', () => {
    const long = 'x'.repeat(120)
    const ics = entriesToIcs([entry([occ()], { title: long })], NOW)
    expect(ics).toContain('\r\n ')
    // Round-trips through the folding-aware parser back to the exact original.
    const [ev] = events(ics)
    if (!ev) throw new Error('no VEVENT')
    expect(textValue(ev, 'SUMMARY')).toBe(long)
  })
})

describe('entriesToIcs — round trip through the importer', () => {
  it('a simple timed occurrence round-trips through icsToEntries unchanged in substance', () => {
    const ics = entriesToIcs([entry([occ()], { title: 'Standup' })], NOW)
    const synthesis = icsToEntries(ics, NOW)
    if (!synthesis) throw new Error('not a calendar')
    expect(synthesis.entries).toHaveLength(1)
    const [synthesized] = synthesis.entries
    expect(synthesized!.content).toContain('title: Standup')
    expect(synthesized!.content).toContain('date: 2026-08-17')
    expect(synthesized!.content).toContain('time: 09:00')
  })

  it('a moved override round-trips back into an excluded original + a moved instance', () => {
    const s = series()
    const moved = occ({ id: 'occ:series-1|2026-08-24|09:00', ownerId: 'series-1', date: '2026-08-26', time: '14:00' })
    const ics = entriesToIcs([entry([s, moved])], NOW)
    const synthesis = icsToEntries(ics, NOW)
    if (!synthesis) throw new Error('not a calendar')
    const [synthesized] = synthesis.entries
    expect(synthesized!.content).toContain('excluded: true')
    expect(synthesized!.content).toContain('2026-08-24')
    expect(synthesized!.content).toContain('2026-08-26')
  })
})

// Re-check that the `props` import is actually exercised (multiple EXDATE lines).
describe('entriesToIcs — multiple exclusions', () => {
  it('emits one EXDATE line per excluded override', () => {
    const s = series()
    const a = occ({ id: 'occ:series-1|2026-08-24|09:00', ownerId: 'series-1', date: '2026-08-24', time: '09:00', excluded: true })
    const b = occ({ id: 'occ:series-1|2026-08-31|09:00', ownerId: 'series-1', date: '2026-08-31', time: '09:00', excluded: true })
    const ics = entriesToIcs([entry([s, a, b])], NOW)
    const [master] = events(ics)
    if (!master) throw new Error('no VEVENT')
    expect(props(master, 'EXDATE').map(p => p.value)).toEqual(['20260824T090000', '20260831T090000'])
  })
})
