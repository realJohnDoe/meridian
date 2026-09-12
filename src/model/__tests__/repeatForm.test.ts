import { describe, it, expect, vi, afterEach } from 'vitest'
import { repeatToForm, formToRepeat, monthlyWeekdaySpec, defaultMonths } from '../repeat'
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
 * cycle.
 */
function roundTrip(repeat: Repeat, scheduledDate: string | null = DATE): Repeat {
  return formToRepeat(repeatToForm(repeat, ctx({ scheduledDate })), scheduledDate)
}

describe('repeatToForm / formToRepeat round-trip', () => {
  describe('values that survive unchanged', () => {
    const survivors: [string, Repeat][] = [
      ['weekly with several weekdays', { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['mo', 'we', 'fr'] }],
      ['daily', { type: 'schedule', freq: 'daily', interval: 3 }],
      ['yearly', { type: 'schedule', freq: 'yearly', interval: 1 }],
      ['yearly in named months', { type: 'schedule', freq: 'yearly', interval: 1, bymonth: [3, 9] }],
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

    it('yearly on the fourth Thursday of November, scheduled on that actual date', () => {
      // 2026-11-26 is the fourth Thursday of November 2026 (US Thanksgiving) —
      // the scheduled date agrees with the stored pattern, so nothing is
      // re-anchored.
      const spec = monthlyWeekdaySpec(new Date(2026, 10, 26))
      const repeat: Repeat = { type: 'schedule', freq: 'yearly', interval: 1, bymonth: [11], byweekday: spec.byweekday, bysetpos: spec.bysetpos }
      expect(roundTrip(repeat, '2026-11-26')).toEqual(repeat)
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

    it('drops a yearly bymonthday, since same-day mode leaves it implicit', () => {
      // bymonthday: [3] disagrees with the scheduled day-of-month (15) — same
      // stale-anchor shape as the monthly case above, but yearly's same-day
      // mode never re-materialises the field (asymmetry 1a): with no
      // bymonthday/byweekday at all, the engine already falls back to the
      // scheduled date's own day.
      const repeat: Repeat = { type: 'schedule', freq: 'yearly', interval: 1, bymonthday: [3] }
      expect(roundTrip(repeat)).toEqual({ type: 'schedule', freq: 'yearly', interval: 1 })
    })

    it('re-anchors a yearly weekday-pattern that disagrees with the scheduled date', () => {
      // Stored as the fourth Thursday of November, but the scheduled date
      // (2026-06-15) is the third Monday of June — the date wins, and the
      // month set carries through unchanged since the form does read it.
      const repeat: Repeat = { type: 'schedule', freq: 'yearly', interval: 1, bymonth: [11], byweekday: ['th'], bysetpos: 4 }
      const spec = monthlyWeekdaySpec(new Date(2026, 5, 15))
      expect(roundTrip(repeat)).toEqual({
        type: 'schedule', freq: 'yearly', interval: 1, bymonth: [11], byweekday: spec.byweekday, bysetpos: spec.bysetpos,
      })
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

  it('reads bymonth into the January-first months array', () => {
    const form = repeatToForm({ type: 'schedule', freq: 'yearly', interval: 1, bymonth: [3, 9] }, ctx())
    expect(form.months).toEqual([false, false, true, false, false, false, false, false, true, false, false, false])
  })

  it('defaults months to none selected when a yearly repeat has no bymonth', () => {
    const form = repeatToForm({ type: 'schedule', freq: 'yearly', interval: 1 }, ctx())
    expect(form.months).toEqual(new Array(12).fill(false))
  })
})

describe('defaultMonths', () => {
  afterEach(() => vi.useRealTimers())

  it('selects the month the scheduled date falls in', () => {
    const expected = new Array(12).fill(false)
    expected[5] = true // June, index 5
    expect(defaultMonths(DATE)).toEqual(expected)
  })

  it('falls back to the current calendar month with no parseable date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 12)) // September

    const expected = new Array(12).fill(false)
    expected[8] = true
    expect(defaultMonths(null)).toEqual(expected)
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

  it('builds bymonth from the months selection on a yearly repeat', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'yearly' as const, months: [false, false, true, false, false, false, false, false, true, false, false, false] }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'schedule', freq: 'yearly', interval: 1, bymonth: [3, 9] })
  })

  it('omits bymonth on a yearly repeat with no months selected', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'yearly' as const }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'schedule', freq: 'yearly', interval: 1 })
  })

  it('ignores the months selection for non-yearly frequencies', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'monthly' as const, months: [true, true, false, false, false, false, false, false, false, false, false, false] }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [15] })
  })

  it('omits an end condition when the value is blank', () => {
    const form = { ...repeatToForm(null, ctx()), freq: 'daily' as const, endType: 'until' as const, endVal: '' }
    expect(formToRepeat(form, DATE)).toEqual({ type: 'schedule', freq: 'daily', interval: 1 })
  })
})
