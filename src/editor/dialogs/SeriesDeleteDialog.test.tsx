// @vitest-environment jsdom
/**
 * Each scope is its own one-tap delete button; "Archive whole file instead" is
 * a separate, non-destructive action that must not touch any scope's onClick.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SeriesDeleteDialog from './SeriesDeleteDialog'
import type { SeriesSheetConfig } from '@/editor/save'

const OPTION_CLICK = vi.fn()

const CONFIG: SeriesSheetConfig = {
  title: 'Delete "Standup"',
  options: [
    { label: 'Delete this occurrence', warning: 'The series ends here.', onClick: OPTION_CLICK },
    { label: 'Delete all occurrences', onClick: vi.fn() },
  ],
}

describe('SeriesDeleteDialog', () => {
  it('deletes with one tap on a scope, and closes', () => {
    OPTION_CLICK.mockClear()
    const onClose = vi.fn()
    render(<SeriesDeleteDialog config={CONFIG} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete this occurrence' }))

    expect(OPTION_CLICK).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalled()
  })

  it("shows an option's warning up front, not only once it is chosen", () => {
    render(<SeriesDeleteDialog config={CONFIG} onClose={vi.fn()} />)
    expect(screen.getByText('The series ends here.')).toBeInTheDocument()
  })

  it('offers no archive action when the config carries none', () => {
    render(<SeriesDeleteDialog config={CONFIG} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument()
  })

  it('archiving calls onArchive and closes, without invoking any delete scope', () => {
    OPTION_CLICK.mockClear()
    const onArchive = vi.fn()
    const onClose    = vi.fn()
    render(<SeriesDeleteDialog config={{ ...CONFIG, onArchive }} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /archive whole file instead/i }))

    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(OPTION_CLICK).not.toHaveBeenCalled()
    // Radix's own dismissal fires onOpenChange(false) on top of the explicit
    // onClose(), so this is >=1, not exactly 1.
    expect(onClose).toHaveBeenCalled()
  })
})
