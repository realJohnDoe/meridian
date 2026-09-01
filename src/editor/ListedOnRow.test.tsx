// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ListedOnRow from './ListedOnRow'
import { setupStore, makeRoots, testKey, TEST_VAULT } from '@/test-utils'
import type { Roots } from '@/types'

setupStore()

// jsdom lays nothing out, so every rect is zeros — and a zero-height anchor
// resting on the top of the usable band reads as "scrolled out of view", which
// makes useFloatingCombobox measure no placement and the portaled list render
// nothing at all (see computeFloatingPlacement). One plausible rect is enough
// to put the suggestions on screen; where the panel lands is
// FloatingComboboxList's own test, not this one's.
Element.prototype.getBoundingClientRect = () =>
  ({ x: 0, y: 100, top: 100, left: 0, right: 200, bottom: 130, width: 200, height: 30, toJSON: () => ({}) })

function renderRow(roots: Roots, onCreate?: (title: string) => void) {
  const onAdd = vi.fn()
  render(
    <ListedOnRow
      linkedKeys={[]}
      entryKey={testKey('buy-milk')}
      vaultId={TEST_VAULT}
      roots={roots}
      onAdd={onAdd}
      onCreate={onCreate}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
  const input = screen.getByPlaceholderText('Search files…')
  return { onAdd, type: (q: string) => fireEvent.change(input, { target: { value: q } }) }
}

describe('ListedOnRow picker', () => {
  it('offers to create the list the query names when nothing matches', () => {
    const onCreate = vi.fn()
    const { type } = renderRow(makeRoots('groceries', { title: 'Groceries' }), onCreate)

    type('Shopping')
    fireEvent.click(screen.getByText('Shopping').closest('[cmdk-item]')!)

    expect(onCreate).toHaveBeenCalledWith('Shopping')
  })

  it('does not offer to create a list that already exists under that name', () => {
    const { type } = renderRow(makeRoots('groceries', { title: 'Groceries' }), vi.fn())

    type('groceries')

    expect(screen.queryByText(/^Create/)).not.toBeInTheDocument()
    expect(screen.getByText('Groceries')).toBeInTheDocument()
  })

  it('does not offer to create a list this entry is already on', () => {
    const onCreate = vi.fn()
    render(
      <ListedOnRow
        linkedKeys={[testKey('groceries')]}
        entryKey={testKey('buy-milk')}
        vaultId={TEST_VAULT}
        roots={makeRoots('groceries', { title: 'Groceries' })}
        onAdd={vi.fn()}
        onCreate={onCreate}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /add to list/i }))
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'Groceries' } })

    // The list is filtered out of the candidates because this entry is already
    // on it — that must not read as "no such list, offer to make one".
    expect(screen.queryByText(/^Create/)).not.toBeInTheDocument()
  })

  it('says nothing matched when there is nothing to create with', () => {
    const { type } = renderRow(makeRoots('groceries', { title: 'Groceries' }))

    type('Shopping')

    expect(screen.getByText('No files found')).toBeInTheDocument()
  })
})
