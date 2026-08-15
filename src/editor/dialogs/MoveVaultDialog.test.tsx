// @vitest-environment jsdom
/**
 * The move dialog is the only place the cost of a move is stated — there is no
 * undo behind it (see storage/moveEntry.ts) — so its copy is worth pinning:
 * both link directions, their singular/plural forms, the "nothing breaks" case,
 * and the slug-collision notice.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MoveVaultDialog from './MoveVaultDialog'
import type { PendingMove } from './MoveVaultDialog'

const BASE: PendingMove = {
  title: 'Meeting notes',
  fromVault: 'Work',
  toVault: 'Personal',
  toSlug: 'meeting-notes',
  slugTaken: false,
  inbound: 0,
  outbound: 0,
}

function show(move: Partial<PendingMove> = {}, onConfirm = vi.fn()) {
  render(<MoveVaultDialog move={{ ...BASE, ...move }} onConfirm={onConfirm} onClose={vi.fn()} />)
  return onConfirm
}

/** The dialog's prose, whitespace-normalised — it wraps across several elements. */
function body(): string {
  return screen.getByRole('alertdialog').textContent.replace(/\s+/g, ' ')
}

describe('MoveVaultDialog', () => {
  it('names both vaults and warns that the move is final', () => {
    show()
    expect(screen.getByRole('heading', { name: 'Move to Personal?' })).toBeInTheDocument()
    expect(body()).toContain('“Meeting notes” moves out of Work and into Personal. This cannot be undone.')
  })

  it('says plainly when nothing breaks', () => {
    show()
    expect(body()).toContain('No wikilinks break')
  })

  it('counts one link in each direction, in the singular', () => {
    show({ inbound: 1, outbound: 1 })
    expect(body()).toContain('1 entry in Work links to this one')
    expect(body()).toContain('1 link inside it points at Work entries')
  })

  it('counts several links in each direction, in the plural', () => {
    show({ inbound: 3, outbound: 2 })
    expect(body()).toContain('3 entries in Work link to this one')
    expect(body()).toContain('2 links inside it point at Work entries')
  })

  it('mentions only the direction that actually breaks', () => {
    show({ inbound: 2 })
    expect(body()).toContain('2 entries in Work link to this one')
    expect(body()).not.toContain('inside it')
  })

  it('warns when the entry has to land on a different slug', () => {
    show({ slugTaken: true, toSlug: 'meeting-notes-2' })
    expect(body()).toContain('meeting-notes-2.md')
  })

  it('says nothing about slugs when the entry keeps its own', () => {
    show()
    expect(body()).not.toContain('meeting-notes.md')
  })

  it('confirms only when Move is pressed', () => {
    const onConfirm = show()
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('renders nothing when no move is pending', () => {
    render(<MoveVaultDialog move={null} onConfirm={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
