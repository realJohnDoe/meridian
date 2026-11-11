// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MarkdownTaskCard from './MarkdownTaskCard'

// jsdom doesn't implement caretRangeFromPoint, so it doesn't exist on
// document at runtime even though the DOM lib types declare it as
// always-present — see caret.test.ts for why defineProperty/deleteProperty
// are used here instead of a plain assignment/delete.
afterEach(() => {
  Reflect.deleteProperty(document, 'caretRangeFromPoint')
})

// Mirrors how ItemsList wires this card: onClickText flips it into edit mode
// with the tapped text as the starting value.
function Harness({ text }: { text: string }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(text)
  return (
    <MarkdownTaskCard
      text={text}
      done={false}
      onToggle={() => {}}
      onPromote={() => {}}
      onClickText={editing ? undefined : () => setEditing(true)}
      editValue={editing ? value : undefined}
      onEditChange={setValue}
      onEditCommit={() => setEditing(false)}
      onEditCancel={() => setEditing(false)}
    />
  )
}

describe('MarkdownTaskCard', () => {
  it('places the caret where the text was tapped, not at the end', () => {
    const textNode = document.createTextNode('buy milk and eggs')
    const range = document.createRange()
    range.setStart(textNode, 7) // tapped right before "and"
    Object.defineProperty(document, 'caretRangeFromPoint', {
      value: () => range,
      configurable: true,
    })

    render(<Harness text="buy milk and eggs" />)
    fireEvent.click(screen.getByText('buy milk and eggs'), { clientX: 50, clientY: 10 })

    const input = screen.getByDisplayValue<HTMLInputElement>('buy milk and eggs')
    expect(input.selectionStart).toBe(7)
    expect(input.selectionEnd).toBe(7)
  })

  it('falls back to the end of the text when the browser exposes no caret API', () => {
    render(<Harness text="buy milk" />)
    fireEvent.click(screen.getByText('buy milk'))

    const input = screen.getByDisplayValue<HTMLInputElement>('buy milk')
    expect(input.selectionStart).toBe('buy milk'.length)
    expect(input.selectionEnd).toBe('buy milk'.length)
  })
})
