// @vitest-environment jsdom
/**
 * The "Archive whole file instead" secondary action — plans/archived-entries.md
 * PR 2. Deliberately not a fifth radio option: it answers a different question
 * (the whole file, not which occurrences), so it must not select an option or
 * touch `onClick`/`onConfirm` on any of them.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SeriesDeleteDialog from './SeriesDeleteDialog'
import type { SeriesSheetConfig } from '@/editor/save'

const OPTION_CLICK = vi.fn()

const CONFIG: SeriesSheetConfig = {
  title: 'Delete "Standup"',
  options: [
    { icon: 'calendar', label: 'This occurrence', sublabel: 'Remove only this occurrence', onClick: OPTION_CLICK },
    { icon: 'calendar-range', label: 'All occurrences', sublabel: 'Remove all occurrences', onClick: vi.fn() },
  ],
}

describe('SeriesDeleteDialog — archive option', () => {
  it('offers no archive action when the config carries none', () => {
    render(<SeriesDeleteDialog config={CONFIG} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument()
  })

  it('archiving calls onArchive and closes, without invoking any delete-scope option', () => {
    OPTION_CLICK.mockClear()
    const onArchive = vi.fn()
    const onClose    = vi.fn()
    render(<SeriesDeleteDialog config={{ ...CONFIG, onArchive }} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /archive whole file instead/i }))

    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(OPTION_CLICK).not.toHaveBeenCalled()
    // Radix's own dismissal fires onOpenChange(false) on top of the explicit
    // onClose() in handleArchive, so this is >=1, not exactly 1 — an existing
    // double-call on every AlertDialogAction, not new to archiving.
    expect(onClose).toHaveBeenCalled()
  })
})
