import { describe, it, expect } from 'vitest'
import { formatHourBoundary, blockGeometry, snapCreateTime } from './timelineGeometry'

describe('formatHourBoundary', () => {
  it('formats 24h boundaries, with 24:00 as a special case past HOURS', () => {
    expect(formatHourBoundary(0, false)).toBe('00:00')
    expect(formatHourBoundary(9, false)).toBe('09:00')
    expect(formatHourBoundary(23, false)).toBe('23:00')
    expect(formatHourBoundary(24, false)).toBe('24:00')
  })

  it('formats 12h boundaries with AM/PM', () => {
    expect(formatHourBoundary(0, true)).toMatch(/12.*AM/i)
    expect(formatHourBoundary(13, true)).toMatch(/1.*PM/i)
    // 24 wraps to 0 (midnight) under 12h formatting, same wall-clock instant as 0:00.
    expect(formatHourBoundary(24, true)).toBe(formatHourBoundary(0, true))
  })
})

describe('blockGeometry', () => {
  it('is column-relative: a single column spans the full width at zero offset', () => {
    const { left, width } = blockGeometry(0, 1)
    expect(width).toBe('calc((100% - 0px) / 1)')
    expect(left).toBe('calc(0 * (((100% - 0px) / 1) + 6px))')
  })

  it('splits two columns evenly with the gap subtracted, offsetting the second by one column + gap', () => {
    const first = blockGeometry(0, 2)
    const second = blockGeometry(1, 2)
    expect(first.width).toBe('calc((100% - 6px) / 2)')
    expect(second.width).toBe(first.width)
    expect(first.left).toBe('calc(0 * (((100% - 6px) / 2) + 6px))')
    expect(second.left).toBe('calc(1 * (((100% - 6px) / 2) + 6px))')
  })

  it('scales the gap subtraction and offset with totalCols', () => {
    const { left, width } = blockGeometry(2, 3)
    expect(width).toBe('calc((100% - 12px) / 3)')
    expect(left).toBe('calc(2 * (((100% - 12px) / 3) + 6px))')
  })

  it('carries no GUTTER/RIGHT_PAD term — geometry is relative to its container, not the pane', () => {
    const { left, width } = blockGeometry(0, 1)
    expect(left).not.toMatch(/64|8px/)
    expect(width).not.toMatch(/64/)
  })
})

describe('snapCreateTime', () => {
  it('snaps to the nearest 15-minute mark', () => {
    expect(snapCreateTime(9, 0)).toBe('09:00')
    expect(snapCreateTime(9, 7)).toBe('09:00')
    expect(snapCreateTime(9, 8)).toBe('09:15')
    expect(snapCreateTime(9, 22)).toBe('09:15')
    expect(snapCreateTime(9, 23)).toBe('09:30')
  })

  it('clamps at the start of the day', () => {
    expect(snapCreateTime(0, 0)).toBe('00:00')
  })

  it('clamps at the end of the day so a new event cannot start past the last valid slot', () => {
    // 23:59 rounds up to 24:00, which is clamped back to the last 15-minute
    // slot of the day (23:45) rather than spilling into the next day.
    expect(snapCreateTime(23, 59)).toBe('23:45')
    expect(snapCreateTime(23, 45)).toBe('23:45')
  })
})
