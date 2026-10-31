// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DatePickerDialog from './DatePickerDialog'
import { setupStore } from '@/test-utils'

setupStore()

/** The grid's button for one day of March 2026 (react-day-picker labels days by full date). */
const day = (n: number) => screen.getAllByRole('button').find(b => b.closest('[data-day="2026-03-' + String(n).padStart(2, '0') + '"]'))!

describe('DatePickerDialog bounds', () => {
  it('greys out days past `max` and refuses to set one', () => {
    const onConfirm = vi.fn()
    render(<DatePickerDialog open initialDate="2026-03-02" max="2026-03-04" onConfirm={onConfirm} onRemove={vi.fn()} onClose={vi.fn()} />)

    expect(day(4)).not.toBeDisabled()
    expect(day(5)).toBeDisabled()

    fireEvent.click(day(4))
    fireEvent.click(screen.getByRole('button', { name: 'Set' }))
    expect(onConfirm).toHaveBeenCalledWith('2026-03-04')
  })

  it('greys out days before `min`', () => {
    render(<DatePickerDialog open initialDate="2026-03-10" min="2026-03-08" onConfirm={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />)
    expect(day(7)).toBeDisabled()
    expect(day(8)).not.toBeDisabled()
  })
})
