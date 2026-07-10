// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RepeatDialog from './RepeatDialog'
import { monthlyWeekdaySpec } from '@/model'
import { setupStore } from '@/test-utils'
import type { Repeat, Scheduled } from '@/types'

setupStore()

interface RenderOpts {
  scheduled?: Scheduled | null
  tracked?: boolean
  itemType?: string
  repeat?: Repeat | null
}

// RepeatDialog only reverse-engineers its internal state from `repeat` when
// `open` transitions to true (useResetOnChange skips the initial mount) —
// mirrors how it's really used: mounted closed, then opened on demand.
function renderOpen(opts: RenderOpts = {}) {
  const onConfirm = vi.fn()
  const onRemove = vi.fn()
  const onClose = vi.fn()
  const props = {
    scheduled: opts.scheduled ?? null,
    tracked: opts.tracked ?? false,
    itemType: opts.itemType,
    repeat: opts.repeat ?? null,
    onConfirm,
    onRemove,
    onClose,
  }
  const { rerender } = render(<RepeatDialog {...props} open={false} />)
  rerender(<RepeatDialog {...props} open={true} />)
  return { onConfirm, onRemove, onClose }
}

function clickSet() {
  fireEvent.click(screen.getByRole('button', { name: 'Set' }))
}

describe('RepeatDialog', () => {
  it('round-trips a weekly repeat unchanged', () => {
    const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['mo', 'we', 'fr'] }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '09:00' } })

    clickSet()

    expect(onConfirm).toHaveBeenCalledWith(repeat)
  })

  it('adding a weekday chip extends byweekday on the encoded payload', () => {
    const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 2, byweekday: ['mo', 'we', 'fr'] }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '09:00' } })

    fireEvent.click(screen.getByRole('button', { name: 'Sa' }))
    clickSet()

    expect(onConfirm).toHaveBeenCalledWith({ ...repeat, byweekday: ['mo', 'we', 'fr', 'sa'] })
  })

  it('monthly same-day recomputes bymonthday from the scheduled date, not the input', () => {
    // bymonthday deliberately mismatches scheduled.date's day-of-month (15) to prove
    // the encoder recomputes it rather than carrying the decoded value through.
    const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [1] }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    clickSet()

    expect(onConfirm).toHaveBeenCalledWith({ type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [15] })
  })

  it('monthly weekday-pattern round-trips to the recomputed byweekday/bysetpos spec', () => {
    const spec = monthlyWeekdaySpec(new Date(2026, 5, 15))
    const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, byweekday: spec.byweekday, bysetpos: spec.bysetpos }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    clickSet()

    expect(onConfirm).toHaveBeenCalledWith({
      type: 'schedule', freq: 'monthly', interval: 1, byweekday: spec.byweekday, bysetpos: spec.bysetpos,
    })
  })

  it('switching monthly mode from same-day to weekday-pattern changes the encoded payload', () => {
    const spec = monthlyWeekdaySpec(new Date(2026, 5, 15))
    const repeat: Repeat = { type: 'schedule', freq: 'monthly', interval: 1, bymonthday: [15] }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    fireEvent.click(screen.getByRole('button', { name: spec.label }))
    clickSet()

    expect(onConfirm).toHaveBeenCalledWith({
      type: 'schedule', freq: 'monthly', interval: 1, byweekday: spec.byweekday, bysetpos: spec.bysetpos,
    })
  })

  it('round-trips an "until" end condition', () => {
    const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'], end: { type: 'until', date: '2026-12-31' } }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    clickSet()

    expect(onConfirm).toHaveBeenCalledWith(repeat)
  })

  it('round-trips a "count" end condition', () => {
    const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'], end: { type: 'count', occurrences: 10 } }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    clickSet()

    expect(onConfirm).toHaveBeenCalledWith(repeat)
  })

  it('switching end type to "After N" and entering a count encodes it', () => {
    const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'] }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    fireEvent.click(screen.getByRole('radio', { name: 'After N' }))
    fireEvent.change(screen.getByPlaceholderText('occurrences'), { target: { value: '5' } })
    clickSet()

    expect(onConfirm).toHaveBeenCalledWith({ ...repeat, end: { type: 'count', occurrences: 5 } })
  })

  it('switching end type to "Never" drops the end condition', () => {
    const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'], end: { type: 'until', date: '2026-12-31' } }
    const { onConfirm } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    fireEvent.click(screen.getByRole('radio', { name: 'Never' }))
    clickSet()

    expect(onConfirm).toHaveBeenCalledWith({ type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'] })
  })

  it('round-trips an after-completion repeat', () => {
    const repeat: Repeat = { type: 'after_completion', interval: '3 weeks' }
    const { onConfirm } = renderOpen({ repeat, scheduled: null, tracked: true })

    clickSet()

    expect(onConfirm).toHaveBeenCalledWith(repeat)
  })

  it('Remove calls onRemove and onClose without confirming', () => {
    const repeat: Repeat = { type: 'schedule', freq: 'weekly', interval: 1, byweekday: ['mo'] }
    const { onConfirm, onRemove, onClose } = renderOpen({ repeat, scheduled: { date: '2026-06-15', time: '' } })

    fireEvent.click(screen.getByRole('button', { name: /Remove/ }))

    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
