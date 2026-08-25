import { describe, it, expect } from 'vitest'
import { repeatToForm, formToRepeat, monthlyWeekdaySpec } from '../repeat'
import type { Repeat } from '@/types'

// The scheduled date every anchored case below hangs off: Monday 2026-06-15,
// the third Monday of June 2026.
const DATE = '2026-06-15'

const ctx = (over: { scheduledDate?: string | null; hasSchedule?: boolean; hasTracking?: boolean } = {}) => ({
  scheduledDate: over.scheduledDate === undefined ? DATE : over.scheduledDate,
  hasSchedule: over.hasSchedule ?? true,
  hasTracking: over.hasTracking ?? false,
})

/**
 * Open the form on `repeat` and immediately encode it back — the open-and-Set
 * cycle. `repeat` is passed back as `previous` because that is what
 * `RepeatDialog` does: it holds the value it was opened on.
 */
function roundTrip(repeat: Repeat, scheduledDate: string | null = DATE): Repeat {
  return formToRepeat(repeatToForm(repeat, ctx({ scheduledDate })), scheduledDate, repeat)
}

describe('repeatToForm / formToRepeat round-trip', () => {
  describe('values that survive unchanged', () => {
    const survivors: [string, Repeat][] = [
      ['weekly with several weekdays', { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['mo', 'we', 'fr'] }],
      ['daily', { type: 'schedule', freq: 'daily', interval: 3 }],
      ['yearly', { type: 'schedule', freq: 'yearly', interval: 1 }],
      // The form shows no month or weekday-position control for a yearly
      // repeat, so these survive only by being carried across — see asymmetry
      // 6 in `repeat.ts`. Without that they would come back as "every June
      // 15th", which is a different holiday.
      ['yearly in named months', { type: 'schedule', freq: 'yearly', interval: 1, bymonth: [3, 9] }],
      ['yearly on the fourth Thursday of November', { type: 'schedule', freq: 'yearly', interval: 1, bymonth: [11], byweekday: ['th'], bysetpos: 4 }],
      ['yearly on a day-of-month', { type: 'schedule', freq: 'yearly', interval: 1, bymonthday: [3] }],
      ['weekly with an until end', { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'], end: { type: 'until', date: '2026-12-31' } }],
      ['weekly with a count end', { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'], end: { type: 'count', occurrences: 10 } }],
      ['monthly on the scheduled day-of-month', { type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [15] }],
      ['after completion', { type: 'after_completion', interval: '3 weeks' }],
    ]

    it.each(survivors)('%s', (_label, repeat) => {
      expect(roundTrip(repeat)).toEqual(repeat)
    })

    it('monthly weekday-pattern matching the scheduled date', () => {
      const spec = monthlyWeekdaySpec(new Date(2026, 5, 15))
      const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, byweekday: spec.byweekday, bysetpos: spec.bysetpos }
      expect(roundTrip(repeat)).toEqual(repeat)
    })
  })

  // Each case below is a deliberate asymmetry. A "tidier" symmetric pair would
  // preserve these inputs instead — and change which dates existing vault files
  // expand to. See the contract comment in model/repeat.ts.
  describe('deliberate lossiness', () => {
    it('re-anchors a stale bymonthday onto the scheduled date', () => {
      const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [1] }
      expect(roundTrip(repeat)).toEqual({ type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [15] })
    })

    it('re-anchors a weekday-pattern that disagrees with the scheduled date', () => {
      // "first Friday" on an item scheduled the third Monday: the date wins.
      const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, byweekday: ['fr'], bysetpos: 1 }
      const spec = monthlyWeekdaySpec(new Date(2026, 5, 15))
      expect(roundTrip(repeat)).toEqual({
        type: 'schedule', freq: 'monthly', interval: 1, byweekday: spec.byweekday, bysetpos: spec.bysetpos,
      })
    })

    it('drops byweekday from a monthly repeat that has no bysetpos', () => {
      // byweekday alone on a monthly repeat reads as 'same-day', so the encode
      // side replaces it with the scheduled day-of-month.
      const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, byweekday: ['mo'] }
      expect(roundTrip(repeat)).toEqual({ type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [15] })
    })

    it('emits no monthly anchor at all when the scheduled date is unparseable', () => {
      const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [15] }
      expect(roundTrip(repeat, null)).toEqual({ type: 'schedule', freq: 'monthly', interval: 1 })
    })

    it('drops the time-of-day from an until end', () => {
      const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'], end: { type: 'until', date: '2026-12-31', time: '09:00' } }
      expect(roundTrip(repeat)).toEqual({
        type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'], end: { type: 'until', date: '2026-12-31' },
      })
    })

    it('drops an end condition from an after-completion repeat', () => {
      const repeat: Repeat = { type: 'after_completion', interval: '2 days', end: { type: 'count', occurrences: 5 } }
      expect(roundTrip(repeat)).toEqual({ type: 'after_completion', interval: '2 days' })
    })

    it('materialises a default interval on a schedule that omitted one', () => {
      const repeat: Repeat = { type: 'schedule', freq: 'daily' }
      expect(roundTrip(repeat)).toEqual({ type: 'schedule', freq: 'daily', interval: 1 })
    })

    it('materialises an empty byweekday on a weekly repeat that omitted one', () => {
      const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 1 }
      expect(roundTrip(repeat)).toEqual({ type: 'schedule', freq: 'weekly', interval: 1, byweekday: [] })
    })
  })
})

describe('repeatToForm', () => {
  it('defaults an untracked scheduled item to weekly on the scheduled weekday', () => {
    const form = repeatToForm(null, ctx())
    expect(form.freq).toBe('weekly')
    // 2026-06-15 is a Monday → index 0 in the Monday-first wdays array
    expect(form.wdays).toEqual([true, false, false, false, false, false, false])
    expect(form.intervalNum).toBe(1)
    expect(form.endType).toBe('never')
  })

  it('defaults a tracked item with no schedule to after-completion', () => {
    const form = repeatToForm(null, ctx({ scheduledDate: null, hasSchedule: false, hasTracking: true }))
    expect(form.freq).toBe('after_completion')
    expect(form.completionNum).toBe(1)
    expect(form.completionUnit).toBe('days')
  })

  it('falls back to Monday when the scheduled date is unparseable', () => {
    const form = repeatToForm(null, ctx({ scheduledDate: 'not-a-date' }))
    expect(form.wdays).toEqual([true, false, false, false, false, false, false])
  })

  it('leaves every weekday unselected when opening a non-weekly repeat', () => {
    // Switching such a repeat to weekly in the picker starts from a clean slate
    // rather than inheriting a monthly pattern's byweekday.
    const form = repeatToForm({ type: 'schedule', freq: 'monthly', interval: 1, byweekday: ['mo'], bysetpos: 3 }, ctx())
    expect(form.wdays).toEqual([false, false, false, false, false, false, false])
    expect(form.monthly).toBe('weekday-pattern')
  })

  it('reads Sunday into the last wdays slot', () => {
    const form = repeatToForm({ type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['su'] }, ctx())
    expect(form.wdays).toEqual([false, false, false, false, false, false, true])
  })
})

describe('formToRepeat', () => {
  it('clamps a non-positive interval to 1', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'daily' as const, intervalNum: 0 }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'schedule', freq: 'daily', interval: 1 })
  })

  it('clamps a non-positive completion interval to 1 and singularises the unit', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'after_completion' as const, completionNum: 0, completionUnit: 'weeks' as const }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'after_completion', interval: '1 week' })
  })

  it('ignores weekday selection for non-weekly frequencies', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'daily' as const, wdays: [true, true, false, false, false, false, false] }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'schedule', freq: 'daily', interval: 1 })
  })

  it('carries a yearly repeat\'s BY* fields across, since the form cannot show them', () => {
    const previous: Repeat = { type: 'schedule', freq: 'yearly', bymonth: [11], byweekday: ['th'], bysetpos: 4 }
    const form = { ...repeatToForm(previous, ctx()), intervalNum: 2 }
    expect(formToRepeat(form, DATE, previous)).toEqual({
      type: 'schedule', freq: 'yearly', interval: 2, bymonth: [11], byweekday: ['th'], bysetpos: 4,
    })
  })

  it('drops them when the user picks a different frequency', () => {
    // Carrying them into a monthly or weekly rule would mean something else
    // entirely: `bysetpos` is read per month there, and `bymonth` as a limit.
    const previous: Repeat = { type: 'schedule', freq: 'yearly', bymonth: [11], byweekday: ['th'], bysetpos: 4 }
    const form = { ...repeatToForm(previous, ctx()), freq: 'weekly' as const }
    // `byweekday` comes out empty because `repeatToForm` reads that field into
    // `wdays` only for a weekly repeat — the pre-existing asymmetry 2, not
    // anything the carry-across does.
    expect(formToRepeat(form, DATE, previous)).toEqual({
      type: 'schedule', freq: 'weekly', interval: 1, byweekday: [],
    })
  })

  it('carries nothing across when the form was opened on no repeat at all', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'yearly' as const }
    expect(formToRepeat(form, DATE, null)).toEqual({ type: 'schedule', freq: 'yearly', interval: 1 })
  })

  it('omits an end condition when the value is blank', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'daily' as const, endType: 'until' as const, endVal: '' }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'schedule', freq: 'daily', interval: 1 })
  })
})
