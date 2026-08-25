// ── The two engines, held against each other ─────────────────────────────────
//
// Meridian carries two independent implementations of recurrence: the product
// engine (`model/expansion.ts`, which reads a `Repeat`) and the RFC-shaped walk
// in `rruleToRepeat.ts` (which reads an RRULE, and exists so unrepresentable
// rules can be expanded honestly). Every mapping between the two — the importer
// `rruleToRepeat` and the exporter `repeatToRrule` — is a claim that a given
// rule means the same thing on both sides. These tests make each claim
// falsifiable by expanding both and comparing the dates.
//
// Three things keep the comparison from passing vacuously:
//
//  1. **Synchronized anchors.** Every case's anchor is a date the rule itself
//     produces, which is what RFC 5545 §3.3.10 requires of DTSTART and what
//     real feeds carry. It also removes the one structural difference between
//     the engines: Meridian emits the anchor as occurrence #1 whether or not
//     the rule selects it, while the RFC walk emits only rule-generated dates.
//     Unsynchronized, the two legitimately disagree — most visibly under
//     `COUNT`, where the anchor would consume one of the N.
//  2. **A window strictly inside the fallback's own.** `expandRRule` expands
//     over a fixed window around `now` and stops at a hard occurrence cap;
//     comparing past either edge would compare against truncation. A test
//     below pins that the densest rule in the corpus outruns the comparison
//     window before any cap bites.
//  3. **A non-triviality floor.** Every case must produce at least two dates,
//     so a corpus entry that silently stopped matching anything cannot pass by
//     agreeing on the empty set.
//
// The series carry no time-of-day (`time: null`). The engines disagree by
// construction about clock times — `expandRRule` works in whole days, the
// product engine at the occurrence's own instant — and that boundary is
// `untilEnd.test.ts`' subject, not this file's. Pinning it to midnight isolates
// what is under test here: which *days* a rule selects.

import { describe, it, expect } from 'vitest'
import { rruleToRepeat, parseRRule, expandRRule } from './rruleToRepeat'
import { repeatToRrule } from './repeatToRrule'
import { expandRange } from '@/model'
import { entryKey } from '@/fileIO'
import type { Repeat, StoreSeries, Roots, Weekday } from '@/types'

/** Fixed so `expandRRule`'s window — `now` −1y … +2y — is deterministic. */
const NOW = new Date(2026, 5, 1) // 2026-06-01

/**
 * The comparison window: inside `expandRRule`'s (2025-06-01 … 2028-05-31) at
 * both ends, and narrow enough at the top that a daily rule reaches it in far
 * fewer than the fallback's 750-occurrence cap. See the pinning test below.
 */
const FROM = new Date(2025, 7, 1)  // 2025-08-01
const TO   = new Date(2027, 5, 30) // 2027-06-30

/** Every case anchors on or after this Monday, so weekday maths starts clean. */
const BASE = new Date(2025, 7, 4) // 2025-08-04, a Monday

const ROOTS: Roots = new Map()

/** `MAX_FALLBACK_OCCURRENCES` in `rruleToRepeat.ts`, which does not export it. */
const FALLBACK_CAP = 750

const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/**
 * The window a comparison runs over. The default is the one above; a rule too
 * sparse to place two dates in it (a yearly rule at `INTERVAL=3`) is compared
 * over its own, still inside `expandRRule`'s `now` −1y … +2y.
 */
interface Window { from: Date; to: Date; now: Date }
const DEFAULT_WINDOW: Window = { from: FROM, to: TO, now: NOW }

/** The days the product engine puts a series on, over the comparison window. */
function meridianDates(repeat: Repeat, anchor: Date, w: Window = DEFAULT_WINDOW): string[] {
  const series: StoreSeries = {
    date: iso(anchor),
    time: null,
    repeat,
    entryKey: entryKey('test-vault', 'series'),
    id: 'series-1',
    metadata: { participants: [] },
  }
  return [...new Set(expandRange([series], ROOTS, w.from, w.to).map(o => o.date))].sort()
}

/** The days the RFC-shaped walk puts the same rule on, over the same window. */
function rfcDates(rrule: string, anchor: Date, w: Window = DEFAULT_WINDOW): string[] {
  const lo = iso(w.from), hi = iso(w.to)
  return expandRRule(parseRRule(rrule), anchor, w.now).filter(d => d >= lo && d <= hi)
}

// ── Anchor selection ─────────────────────────────────────────────────────────

const JS_DAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
const daysInMonth = (y: number, m0: number): number => new Date(y, m0 + 1, 0).getDate()

/**
 * The anchor for a weekly BYDAY rule: the first of its named weekdays, counting
 * from Monday.
 *
 * Being *first in the RFC week* is what makes the rule representable at
 * `INTERVAL >= 2` — `weeklyWindowsAgree` claims a rule only when no named
 * weekday falls before the anchor's inside the RFC week, since Meridian's
 * windows start on the anchor's weekday and the RFC's on `WKST`. Any other
 * choice sends half the weekly corpus to the fallback and quietly shrinks the
 * property's reach.
 */
function weeklyAnchor(days: string[]): Date {
  const offsets = days.map(d => (JS_DAY[d]! - BASE.getDay() + 7) % 7)
  return addDays(BASE, Math.min(...offsets))
}

/** The first day-of-month in `days` landing on or after BASE. */
function monthDayAnchor(days: number[]): Date {
  for (let m = 0; m < 24; m++) {
    const probe = new Date(BASE.getFullYear(), BASE.getMonth() + m, 1)
    const len = daysInMonth(probe.getFullYear(), probe.getMonth())
    const resolved = days.map(d => (d > 0 ? d : len + d + 1)).filter(d => d >= 1 && d <= len).sort((a, b) => a - b)
    for (const d of resolved) {
      const at = new Date(probe.getFullYear(), probe.getMonth(), d)
      if (at >= BASE) return at
    }
  }
  throw new Error(`no anchor for BYMONTHDAY=${days.join(',')}`)
}

/** The date `pos` selects among a month's days matching `days`, from BASE on. */
function setPosAnchor(days: string[], pos: number): Date {
  const dows = days.map(d => JS_DAY[d]!)
  for (let m = 0; m < 24; m++) {
    const probe = new Date(BASE.getFullYear(), BASE.getMonth() + m, 1)
    const y = probe.getFullYear(), m0 = probe.getMonth()
    const candidates: Date[] = []
    for (let d = 1; d <= daysInMonth(y, m0); d++) {
      const at = new Date(y, m0, d)
      if (dows.includes(at.getDay())) candidates.push(at)
    }
    const at = pos > 0 ? candidates[pos - 1] : candidates[candidates.length + pos]
    if (at && at >= BASE) return at
  }
  throw new Error(`no anchor for BYDAY=${days.join(',')};BYSETPOS=${pos}`)
}

// ── The RRULE corpus ─────────────────────────────────────────────────────────

interface Case { rrule: string; anchor: Date; window?: Window }

/**
 * The yearly cases run to the far edge of `expandRRule`'s window rather than
 * stopping at `TO`.
 *
 * `TO` is held down by the densest rule in the corpus — a daily one reaches the
 * fallback's occurrence cap partway through 2027 — but a yearly rule places
 * three dates in three years and comes nowhere near it. Without the extra
 * months, every yearly rule at `INTERVAL=2` would have exactly its anchor to
 * compare, which is agreement about almost nothing.
 */
const YEARLY_WINDOW: Window = { from: FROM, to: new Date(2028, 4, 31), now: NOW }

/**
 * End conditions, crossed over every rule body below.
 *
 * `COUNT=5` bites well inside the window; `COUNT=40` outruns it, so the series
 * behaves as unbounded there and the two engines have to agree on *not*
 * truncating. The two `UNTIL` spellings cover both halves of the field: a
 * date-only bound is inclusive of its whole day, one carrying a time bounds an
 * instant.
 */
const ENDS = ['', ';COUNT=5', ';COUNT=40', ';UNTIL=20261115', ';UNTIL=20261115T090000Z']

/** Rule bodies, each paired with an anchor the rule itself produces. */
function ruleBodies(): Case[] {
  const out: Case[] = []
  const push = (rrule: string, anchor: Date, window?: Window): void => { out.push({ rrule, anchor, window }) }

  for (const interval of [1, 2, 3]) {
    const iv = interval > 1 ? `;INTERVAL=${interval}` : ''

    // DAILY takes no BY* part the engine can read — that is the whole shape.
    push(`FREQ=DAILY${iv}`, BASE)

    // WEEKLY: bare (the anchor's own weekday), then BYDAY sets of one, two and
    // three days, including one spanning the RFC week's Sunday end.
    push(`FREQ=WEEKLY${iv}`, BASE)
    for (const days of [['TU'], ['MO', 'WE', 'FR'], ['WE', 'SA'], ['TH', 'SU'], ['MO', 'TU', 'WE', 'TH', 'FR']]) {
      push(`FREQ=WEEKLY${iv};BYDAY=${days.join(',')}`, weeklyAnchor(days))
    }

    // MONTHLY: bare (the anchor's day-of-month), by day-of-month including a
    // 31st that several months cannot hold, and by weekday-position in both
    // spellings the RFC allows.
    push(`FREQ=MONTHLY${iv}`, new Date(2025, 7, 10))
    for (const days of [[15], [1, 15], [31], [10, 20, 30]]) {
      push(`FREQ=MONTHLY${iv};BYMONTHDAY=${days.join(',')}`, monthDayAnchor(days))
    }
    for (const [days, pos] of [[['FR'], 2], [['MO'], 1], [['TU'], -1], [['MO', 'WE'], 3], [['MO', 'TU', 'WE', 'TH', 'FR'], -1], [['FR'], -2]] as Array<[string[], number]>) {
      push(`FREQ=MONTHLY${iv};BYDAY=${days.join(',')};BYSETPOS=${pos}`, setPosAnchor(days, pos))
      if (days.length === 1) push(`FREQ=MONTHLY${iv};BYDAY=${pos}${days[0]}`, setPosAnchor(days, pos))
    }
    // A BYSETPOS list — "first and third Monday", "first and last Friday".
    for (const [days, positions] of [[['MO'], [1, 3]], [['FR'], [1, -1]]] as Array<[string[], number[]]>) {
      push(`FREQ=MONTHLY${iv};BYDAY=${days.join(',')};BYSETPOS=${positions.join(',')}`, setPosAnchor(days, positions[0]!))
    }

    // YEARLY: bare, and the two BY* spellings that restate the anchor's own
    // month and day — the only yearly shapes the engine can carry today.
    // Stops at INTERVAL=2: a three-yearly rule cannot place two dates inside a
    // window three years wide, whichever three years are chosen.
    if (interval <= 2) {
      const aug20 = new Date(2025, 7, 20)
      push(`FREQ=YEARLY${iv}`, aug20, YEARLY_WINDOW)
      push(`FREQ=YEARLY${iv};BYMONTH=8`, aug20, YEARLY_WINDOW)
      push(`FREQ=YEARLY${iv};BYMONTH=8;BYMONTHDAY=20`, aug20, YEARLY_WINDOW)
    }
  }
  return out
}

const CORPUS: Case[] = ruleBodies().flatMap(({ rrule, anchor, window }) =>
  ENDS.map(end => ({ rrule: rrule + end, anchor, window })),
)

/** The corpus is built entirely from shapes the importer carries as rules. */
const CLAIMED = CORPUS.filter(c => rruleToRepeat(c.rrule, c.anchor, NOW).kind === 'repeat')

/**
 * Shapes the importer still refuses, each sent to bounded expansion instead.
 *
 * They are listed — and asserted — rather than merely absent from the corpus,
 * because "the engine cannot carry this" is a claim that goes stale: every one
 * of these is a gap a later PR in the iCal/RRULE plan closes, and when one is
 * closed this list is where it has to announce itself instead of the corpus
 * quietly never having covered it.
 */
const STILL_DECLINED: Array<{ rrule: string; anchor: Date; why: string }> = [
  { rrule: 'FREQ=DAILY;BYDAY=MO,WE,FR', anchor: BASE, why: 'daily takes no BY* part' },
  { rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1', anchor: monthDayAnchor([-1]), why: 'negative day-of-month' },
  { rrule: 'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH', anchor: new Date(2025, 10, 27), why: 'yearly reads no BY* part' },
  { rrule: 'FREQ=YEARLY;BYMONTH=3,9', anchor: new Date(2026, 2, 10), why: 'no bymonth in the engine' },
  { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO', anchor: new Date(2025, 7, 10), why: 'the two weeks disagree' },
  { rrule: 'FREQ=HOURLY;INTERVAL=6', anchor: BASE, why: 'sub-daily has no occurrence model' },
]

function repeatFor(c: Case): Repeat {
  const mapped = rruleToRepeat(c.rrule, c.anchor, NOW)
  if (mapped.kind !== 'repeat') throw new Error(`${c.rrule} was declined`)
  return mapped.repeat
}

// ── The corpus itself, before it is used to prove anything ───────────────────

describe('the round-trip corpus', () => {
  it('is large, and claimed by the importer in full', () => {
    expect(CORPUS.length).toBeGreaterThan(300)
    // Every body in the corpus is a shape the engine carries as a rule. A case
    // that quietly started falling back would leave the property asserting
    // nothing about it, so the count is pinned rather than filtered.
    expect(CLAIMED.length).toBe(CORPUS.length)
  })

  it('is dense enough that agreement means something', () => {
    // The floor each case carries is "not the empty set", which a sparse rule
    // like a three-yearly one can satisfy with a single date. This is the
    // counterweight: across the corpus the comparison is over thousands of
    // dates, and the overwhelming majority of cases place several.
    const counts = CLAIMED.map(c => rfcDates(c.rrule, c.anchor, c.window).length)
    expect(counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(5000)
    expect(counts.filter(n => n >= 3).length / counts.length).toBeGreaterThan(0.9)
  })

  it('leaves the shapes the engine cannot carry to bounded expansion', () => {
    for (const { rrule, anchor, why } of STILL_DECLINED) {
      expect(rruleToRepeat(rrule, anchor, NOW).kind, `${rrule} — ${why}`).toBe('dates')
    }
  })

  it('exercises every frequency the engine has', () => {
    for (const freq of ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']) {
      expect(CLAIMED.filter(c => c.rrule.startsWith(`FREQ=${freq}`)).length).toBeGreaterThan(5)
    }
  })

  it('exercises every end condition, and intervals above 1', () => {
    for (const end of ENDS.filter(e => e !== '')) {
      expect(CLAIMED.filter(c => c.rrule.endsWith(end)).length).toBeGreaterThan(3)
    }
    expect(CLAIMED.filter(c => c.rrule.includes('INTERVAL=')).length).toBeGreaterThan(50)
  })

  it('anchors every case on a date the rule itself produces', () => {
    // Synchronization is what lets the comparison be exact equality. If an
    // anchor helper ever picks a date the rule does not generate, the RFC walk
    // will not emit it and this catches it here rather than as a confusing
    // one-date diff inside the property.
    for (const c of CLAIMED) {
      expect(rfcDates(c.rrule, c.anchor, c.window)).toContain(iso(c.anchor))
    }
  })

  it('pins the fallback occurrence cap it reasons about', () => {
    // `rruleToRepeat.ts` does not export MAX_FALLBACK_OCCURRENCES, so the
    // truncation check below carries the number. This is what keeps that copy
    // honest: the densest rule there is — one date per day, unbounded — runs
    // until the cap stops it, so its length *is* the cap.
    expect(expandRRule(parseRRule('FREQ=DAILY'), BASE, NOW).length).toBe(FALLBACK_CAP)
  })

  it('never compares against a truncated expansion', () => {
    // Two things can cut `expandRRule` short before a comparison window ends:
    // its occurrence cap, and the far edge of its own `now` −1y … +2y window.
    // Either would silently turn "the engines disagree past this date" into
    // "the RFC side simply stopped", so both are ruled out for every case
    // rather than argued once for the corpus as a whole.
    for (const c of CLAIMED) {
      const w = c.window ?? DEFAULT_WINDOW
      const windowEnd = iso(new Date(w.now.getTime() + 730 * 86_400_000))
      expect(iso(w.to) <= windowEnd, `${c.rrule}: window runs past the fallback's`).toBe(true)

      const all = expandRRule(parseRRule(c.rrule), c.anchor, w.now)
      const cut = all.length >= FALLBACK_CAP && all[all.length - 1]! < iso(w.to)
      expect(cut, `${c.rrule}: capped at ${all[all.length - 1] ?? '—'}, inside the window`).toBe(false)
    }
  })
})

// ── The property ─────────────────────────────────────────────────────────────

describe('rruleToRepeat — every claimed rule expands to the RRULE it came from', () => {
  it.each(CLAIMED.map(c => [c.rrule, c] as const))('%s', (_label, c) => {
    const rfc = rfcDates(c.rrule, c.anchor, c.window)
    expect(rfc.length).toBeGreaterThanOrEqual(1) // never agree on the empty set
    expect(meridianDates(repeatFor(c), c.anchor, c.window)).toEqual(rfc)
  })
})

describe('repeatToRrule — the emitted rule expands to the same dates as the repeat', () => {
  it.each(CLAIMED.map(c => [c.rrule, c] as const))('%s', (_label, c) => {
    const repeat = repeatFor(c)
    const emitted = repeatToRrule(repeat, c.anchor)
    expect(emitted).not.toBeNull()
    const mine = meridianDates(repeat, c.anchor, c.window)
    expect(mine.length).toBeGreaterThanOrEqual(1)
    expect(rfcDates(emitted!, c.anchor, c.window)).toEqual(mine)
  })
})

// ── Repeat shapes the importer never produces ────────────────────────────────

/**
 * `Repeat` is a looser type than the engine that reads it: `repeat:` is written
 * to YAML verbatim and read back with an unchecked cast, so a file can carry
 * field combinations no importer or dialog would ever build — and the engine
 * resolves them by branch precedence, ignoring whatever the branch it picked
 * does not name. These are the cases where `repeatToRrule` has to emit what the
 * engine *does* rather than what the object says, so they get the same
 * expand-both-and-compare treatment as the corpus above.
 */
const HAND_BUILT: Array<{ label: string; repeat: Repeat; anchor: Date }> = [
  {
    label: 'daily with BYDAY limits (the weekdays-only rule the importer declines)',
    repeat: { type: 'schedule', freq: 'daily', byweekday: ['mo', 'we', 'fr'] },
    anchor: BASE,
  },
  {
    label: 'daily with a BYMONTHDAY limit',
    repeat: { type: 'schedule', freq: 'daily', bymonthday: [1, 15] },
    anchor: monthDayAnchor([1, 15]),
  },
  {
    label: 'weekly, interval 2, spanning the RFC week boundary — WKST is load-bearing',
    // Sunday-anchored with a Monday in the set: under the RFC's default
    // Monday-start week the Monday falls in the *previous* week and the two
    // engines land a week apart from then on. `weeklyWindowsAgree` declines
    // this on import for exactly that reason; the export has to state the
    // anchor's weekday as WKST instead.
    repeat: { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['su', 'mo'] },
    anchor: new Date(2025, 7, 10), // 2025-08-10, a Sunday
  },
  {
    label: 'weekly with bymonthday and bysetpos the weekly branch never reads',
    repeat: { type: 'schedule', freq: 'weekly', byweekday: ['tu'], bymonthday: [15], bysetpos: 2 },
    anchor: weeklyAnchor(['TU']),
  },
  {
    label: 'monthly with byweekday but no bysetpos — falls through to the anchor day',
    repeat: { type: 'schedule', freq: 'monthly', byweekday: ['fr'] },
    anchor: new Date(2025, 7, 10),
  },
  {
    label: 'monthly with bymonthday winning over a byweekday alongside it',
    repeat: { type: 'schedule', freq: 'monthly', bymonthday: [12], byweekday: ['fr'], bysetpos: 2 },
    anchor: monthDayAnchor([12]),
  },
  {
    label: 'monthly on the last day of the month',
    repeat: { type: 'schedule', freq: 'monthly', bymonthday: [-1] },
    anchor: monthDayAnchor([-1]),
  },
  {
    label: 'monthly on the last weekday of the month',
    repeat: { type: 'schedule', freq: 'monthly', byweekday: ['mo', 'tu', 'we', 'th', 'fr'], bysetpos: -1 },
    anchor: setPosAnchor(['MO', 'TU', 'WE', 'TH', 'FR'], -1),
  },
  {
    label: 'yearly with BY* fields the yearly branch ignores entirely',
    repeat: { type: 'schedule', freq: 'yearly', byweekday: ['fr'], bymonthday: [3], bysetpos: 2 },
    anchor: new Date(2025, 7, 20),
  },
  {
    label: 'monthly on the 31st, with a count that outlives the window',
    repeat: { type: 'schedule', freq: 'monthly', bymonthday: [31], end: { type: 'count', occurrences: 30 } },
    anchor: monthDayAnchor([31]),
  },
  {
    label: 'weekly bounded by an instant rather than a whole day',
    repeat: {
      type: 'schedule', freq: 'weekly', byweekday: ['tu'],
      end: { type: 'until', date: '2026-11-15', time: '09:00' },
    },
    anchor: weeklyAnchor(['TU']),
  },
]

describe('repeatToRrule — repeat shapes the importer never produces', () => {
  it.each(HAND_BUILT.map(c => [c.label, c] as const))('%s', (_label, c) => {
    const emitted = repeatToRrule(c.repeat, c.anchor)
    expect(emitted).not.toBeNull()
    const mine = meridianDates(c.repeat, c.anchor)
    expect(mine.length).toBeGreaterThanOrEqual(2)
    expect(rfcDates(emitted!, c.anchor)).toEqual(mine)
  })

  it('yearly on a Feb 29 anchor lands only in leap years, never on March 1', () => {
    // Stated as an expected date rather than as agreement between the two
    // engines: a Feb 29 rule places at most one date in a window three years
    // wide, and "both produced nothing" would satisfy agreement while hiding
    // the failure this guards — a rule that overflows into March 1 every year.
    const window: Window = { from: new Date(2027, 0, 1), to: new Date(2029, 5, 30), now: new Date(2028, 0, 1) }
    const repeat: Repeat = { type: 'schedule', freq: 'yearly' }
    const anchor = new Date(2024, 1, 29)
    const emitted = repeatToRrule(repeat, anchor)
    expect(emitted).toBe('FREQ=YEARLY')
    expect(meridianDates(repeat, anchor, window)).toEqual(['2028-02-29'])
    expect(rfcDates(emitted!, anchor, window)).toEqual(['2028-02-29'])
  })
})

// ── The emitted strings themselves ───────────────────────────────────────────

const MON = new Date(2025, 7, 4)  // Monday
const SUN = new Date(2025, 7, 10) // Sunday

describe('repeatToRrule — spelling', () => {
  const sched = (r: Partial<Extract<Repeat, { type: 'schedule' }>>): Repeat =>
    ({ type: 'schedule', freq: 'daily', ...r })

  it('omits INTERVAL when it is 1', () => {
    expect(repeatToRrule(sched({}), MON)).toBe('FREQ=DAILY')
    expect(repeatToRrule(sched({ interval: 1 }), MON)).toBe('FREQ=DAILY')
    expect(repeatToRrule(sched({ interval: 4 }), MON)).toBe('FREQ=DAILY;INTERVAL=4')
  })

  it('names the weekdays in the order the repeat lists them', () => {
    expect(repeatToRrule(sched({ freq: 'weekly', byweekday: ['we', 'mo'] }), MON))
      .toBe('FREQ=WEEKLY;BYDAY=WE,MO')
  })

  it('emits WKST only for a weekly BYDAY rule that repeats less often than weekly', () => {
    const days: Weekday[] = ['mo', 'we']
    expect(repeatToRrule(sched({ freq: 'weekly', byweekday: days }), SUN))
      .toBe('FREQ=WEEKLY;BYDAY=MO,WE')
    expect(repeatToRrule(sched({ freq: 'weekly', byweekday: days, interval: 2 }), SUN))
      .toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU')
    // No BYDAY: the rule repeats DTSTART's own weekday, which no week boundary
    // can move.
    expect(repeatToRrule(sched({ freq: 'weekly', interval: 2 }), SUN)).toBe('FREQ=WEEKLY;INTERVAL=2')
  })

  it('writes a monthly weekday-position as BYDAY + BYSETPOS, not an ordinal BYDAY', () => {
    // Both spellings are legal and equivalent for one weekday, but only this
    // one generalises to the several-weekday sets Meridian also allows.
    expect(repeatToRrule(sched({ freq: 'monthly', byweekday: ['fr'], bysetpos: 2 }), MON))
      .toBe('FREQ=MONTHLY;BYDAY=FR;BYSETPOS=2')
    expect(repeatToRrule(sched({ freq: 'monthly', byweekday: ['mo', 'fr'], bysetpos: -1 }), MON))
      .toBe('FREQ=MONTHLY;BYDAY=MO,FR;BYSETPOS=-1')
  })

  it('drops fields the branch that will run does not read', () => {
    expect(repeatToRrule(sched({ freq: 'monthly', byweekday: ['fr'] }), MON)).toBe('FREQ=MONTHLY')
    expect(repeatToRrule(sched({ freq: 'monthly', bymonthday: [9], byweekday: ['fr'], bysetpos: 2 }), MON))
      .toBe('FREQ=MONTHLY;BYMONTHDAY=9')
    expect(repeatToRrule(sched({ freq: 'weekly', byweekday: ['fr'], bymonthday: [9], bysetpos: 2 }), MON))
      .toBe('FREQ=WEEKLY;BYDAY=FR')
    expect(repeatToRrule(sched({ freq: 'yearly', byweekday: ['fr'], bymonthday: [9], bysetpos: 2 }), MON))
      .toBe('FREQ=YEARLY')
  })

  it('keeps BYDAY and BYMONTHDAY at daily frequency, where both are limits', () => {
    expect(repeatToRrule(sched({ freq: 'daily', byweekday: ['mo', 'fr'], bymonthday: [1, -1] }), MON))
      .toBe('FREQ=DAILY;BYDAY=MO,FR;BYMONTHDAY=1,-1')
  })

  it('writes a date-only UNTIL as a date and a timed one as a UTC instant', () => {
    expect(repeatToRrule(sched({ end: { type: 'until', date: '2026-11-15' } }), MON))
      .toBe('FREQ=DAILY;UNTIL=20261115')
    expect(repeatToRrule(sched({ end: { type: 'until', date: '2026-11-15', time: '09:00' } }), MON))
      .toBe('FREQ=DAILY;UNTIL=20261115T090000Z') // the suite runs in UTC
  })

  it('ignores an until that names no date, since it bounds nothing', () => {
    expect(repeatToRrule(sched({ end: { type: 'until', time: '09:00' } }), MON)).toBe('FREQ=DAILY')
  })

  it('carries COUNT across unchanged, and never emits the illegal COUNT=0', () => {
    expect(repeatToRrule(sched({ end: { type: 'count', occurrences: 7 } }), MON)).toBe('FREQ=DAILY;COUNT=7')
    expect(repeatToRrule(sched({ end: { type: 'count', occurrences: 0 } }), MON)).toBe('FREQ=DAILY;COUNT=1')
    expect(repeatToRrule(sched({ end: { type: 'count', occurrences: -3 } }), MON)).toBe('FREQ=DAILY;COUNT=1')
  })

  it('returns null for rules RFC 5545 cannot express', () => {
    expect(repeatToRrule({ type: 'after_completion', interval: '3 days' }, MON)).toBeNull()
    // Reached only from hand-edited YAML — `repeat:` is cast, not validated.
    expect(repeatToRrule(sched({ interval: 0 }), MON)).toBeNull()
    expect(repeatToRrule(sched({ interval: -2 }), MON)).toBeNull()
    expect(repeatToRrule(sched({ freq: 'fortnightly' as 'daily' }), MON)).toBeNull()
    expect(repeatToRrule(sched({ freq: 'monthly', byweekday: ['fr'], bysetpos: 0 }), MON)).toBeNull()
  })
})

describe('repeatToRrule — round-trips back through the importer', () => {
  it('returns the same repeat the RRULE mapped to', () => {
    for (const c of CLAIMED) {
      const repeat = repeatFor(c)
      const emitted = repeatToRrule(repeat, c.anchor)
      const back = rruleToRepeat(emitted!, c.anchor, NOW)
      expect(back.kind, `${c.rrule} -> ${emitted!}`).toBe('repeat')
      if (back.kind === 'repeat') expect(back.repeat, `${c.rrule} -> ${emitted!}`).toEqual(repeat)
    }
  })
})
