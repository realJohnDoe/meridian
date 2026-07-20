// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { setupStore, seedStore, makeRoots } from '@/test-utils'
import ItemsList from './ItemsList'

setupStore()

describe('ItemsList Add item combobox', () => {
  it('keeps cmdk arrow-key navigation and selection working with an in-flow (non-portaled) list', () => {
    const roots = makeRoots('note.md', { title: 'Current' })
    roots.set('other.md', { title: 'Other Note', tags: [], items: [] })
    seedStore([], roots)

    const onChange = vi.fn()
    render(
      <ItemsList
        items={[]}
        onChange={onChange}
        roots={roots}
        currentSlug="note.md"
        onPromote={() => null}
      />,
    )

    fireEvent.click(screen.getByText('Add item…'))

    const input = screen.getByPlaceholderText('Add item or link file…')
    fireEvent.change(input, { target: { value: 'Other' } })

    // cmdk tracks the highlighted item via `[cmdk-item][aria-selected="true"]`,
    // queried against the Command *root* — this only resolves if the list stays
    // a DOM descendant of that root rather than being portaled away (as a Radix
    // Popover would do), which is the load-bearing assumption of InlineCombobox.
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith(['[[other.md]]'])
  })
})
