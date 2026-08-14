/**
 * A recurrence rule must mean the same thing on every device.
 *
 * This file used to assert the opposite: one test pinned the Monday-started
 * reading of a biweekly rule and another pinned the Sunday-started reading of
 * the SAME rule, both passing, each expecting a different set of dates. That
 * was the survey's finding #6 recorded as intended behaviour — `expandRange`
 * took a `weekStart` sourced from the viewer's locale (`weekStartsOn(
 * localePrefs)`, auto-detected per device), so one `.md` file expanded to two
 * disjoint calendars depending on who opened it, and an override written on
 * one device landed on a date the other device's schedule never generates.
 *
 * `weekStart` is gone from the expansion API entirely now: the week is
 * anchored on the series' own anchor date, which is already in the file. See
 * `generateScheduledDates`' weekly branch. `weekStartsOn` still exists and is
 * still locale-driven — it drives the month grid, the date picker, and the
 * weekday-checkbox order in RepeatDialog, which are genuinely presentational.
 */
import { describe, it, expect } from 'vitest'
import { expandRange } from '@/model/expansion'
import type { StoreSeries, Roots } from '@/types'

function series(overrides: Partial<StoreSeries> = {}): StoreSeries {
  return {
    date: '2026-04-02', // Thursday
    time: null,
    repeat: { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['su'] },
    entryKey: 'note.md',
    id: 'series-1',
    metadata: { participants: [] },
    ...overrides,
  }
}

const roots: Roots = new Map()
const FROM = new Date('2026-04-01')
const TO   = new Date('2026-05-31')

const datesOf = (s: StoreSeries) => expandRange([s], roots, FROM, TO).map(o => o.date)

describe('weekly recurrence is locale-independent', () => {
  // NOTE ON WHAT THESE TESTS CAN AND CANNOT PROVE. The primary symptom of #6 —
  // the same file expanding differently per device — is no longer *expressible*
  // as a test, because the knob that caused it is gone from the signature. That
  // is a stronger guarantee than any assertion here, but it does mean only the
  // last test below is red-then-green; verified by reverting expansion.ts.
  //
  // This first one passes against the old code too, because a THURSDAY anchor
  // happens to bucket identically under Monday-started weeks. It still earns
  // its place: it pins the survey's canonical repro, so re-breaking the
  // bucketing shows up here. What it does NOT show is the divergence — under
  // the old code a Sunday-first (US) reader got
  // ['2026-04-02', '2026-04-12', '2026-04-26', '2026-05-10', '2026-05-24']
  // for this very series. Those users' dates DO change with this fix; that is
  // the migration cost, accepted because there was no consistent behaviour to
  // preserve in the first place.
  it('a biweekly byweekday rule expands from the anchor, not the viewer locale', () => {
    expect(datesOf(series())).toEqual(
      ['2026-04-02', '2026-04-05', '2026-04-19', '2026-05-03', '2026-05-17', '2026-05-31'],
    )
  })

  // interval: 1 was never affected, and this pins why: with a 7-day step every
  // 7-day window holds each weekday exactly once wherever the boundary is
  // drawn, so the windows tile identically. Anchoring the week changed nothing
  // here — which is what keeps ordinary weekly series (the overwhelming
  // majority) byte-identical across this fix.
  it('interval: 1 is unchanged by anchoring the week', () => {
    expect(datesOf(series({ repeat: { type: 'schedule', freq: 'weekly', byweekday: ['su'] } }))).toEqual(
      ['2026-04-02', '2026-04-05', '2026-04-12', '2026-04-19', '2026-04-26',
       '2026-05-03', '2026-05-10', '2026-05-17', '2026-05-24', '2026-05-31'],
    )
  })

  // Multi-weekday, interval 1 — the shape the shipped tutorial vault uses
  // (`byweekday: [mo, we, fr]`), pinned so the common case can't drift.
  it('a multi-weekday weekly rule keeps every named day', () => {
    const dates = datesOf(series({
      date: '2026-04-06', // Monday
      repeat: { type: 'schedule', freq: 'weekly', byweekday: ['mo', 'we', 'fr'] },
    })).slice(0, 6)
    expect(dates).toEqual(
      ['2026-04-06', '2026-04-08', '2026-04-10', '2026-04-13', '2026-04-15', '2026-04-17'],
    )
  })

  // THE discriminating test — the one that actually fails against the old
  // implementation. The anchor's own weekday defines the fortnight, so a rule
  // naming a weekday that falls EARLIER in the locale week than the anchor
  // still lands inside the anchor's own fortnight rather than being pushed a
  // week out. Under the old Monday-started reading this Saturday resolved to
  // 2026-04-18 — a full 13 days after the anchor — because 04-04 fell before
  // the anchor and was filtered, so the first surviving Saturday was in the
  // NEXT fortnight. Anchoring the week gives 04-11, six days out, which is
  // also what someone writing "every 2 weeks on Saturday" starting Sunday
  // would expect.
  it('a named day earlier in the week than the anchor stays in the anchor fortnight', () => {
    expect(datesOf(series({
      date: '2026-04-05', // Sunday
      repeat: { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['sa'] },
    }))).toEqual(['2026-04-05', '2026-04-11', '2026-04-25', '2026-05-09', '2026-05-23'])
  })
})
