// @vitest-environment jsdom
/**
 * The "Archive instead" secondary action — plans/archived-entries.md PR 2.
 * `onConfirm`/Delete's own behaviour predates this PR and isn't re-pinned here.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DeleteDialog from './DeleteDialog'

describe('DeleteDialog — archive option', () => {
  it('offers no archive action when the caller supplies none', () => {
    render(<DeleteDialog open title="Old note" onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /archive/i })).not.toBeInTheDocument()
  })

  it('archiving calls onArchive and closes, without also deleting', () => {
    const onArchive = vi.fn()
    const onConfirm = vi.fn()
    const onClose   = vi.fn()
    render(<DeleteDialog open title="Old note" onConfirm={onConfirm} onArchive={onArchive} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: /archive instead/i }))

    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    // Radix's own dismissal fires onOpenChange(false) on top of the explicit
    // onClose() in the click handler, so this is >=1, not exactly 1 — an
    // existing double-call on every AlertDialogAction, not new to archiving.
    expect(onClose).toHaveBeenCalled()
  })
})
