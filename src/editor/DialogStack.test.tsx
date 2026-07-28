// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useEntryDialogs } from './useEntryDialogs'
import DialogStack from './DialogStack'
import { ENTRY_DEFAULT } from './state'
import { setupStore } from '@/test-utils'

setupStore()

// A scheduled entry, so RepeatDialog opens on the "Calendar Schedule" branch
// (an unscheduled+tracked entry defaults to "After completion", which hides the
// Ends section and with it the nested end-date picker this test drives).
const ENTRY = { ...ENTRY_DEFAULT, scheduled: { date: '2026-06-15', time: '09:00' } }

/** Mirrors the real wiring in EditorShell: the hook owns activeDialog, DialogStack renders it. */
function Harness() {
  const { dialogHandlers, handleOpenRepeatDlg } = useEntryDialogs(ENTRY, vi.fn())
  return (
    <>
      <button onClick={() => handleOpenRepeatDlg()}>open repeat</button>
      <DialogStack entry={ENTRY} handlers={dialogHandlers} />
    </>
  )
}

const isOpen = (title: 'Repeat' | 'Date') => screen.queryAllByText(title).length > 0

function pressEscape() {
  act(() => { fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' }) })
}

function openRepeatDialog() {
  render(<Harness />)
  act(() => { fireEvent.click(screen.getByText('open repeat')) })
  expect(isOpen('Repeat')).toBe(true)
}

/** Ends → "On date", then open the nested end-date picker. */
function openNestedDatePicker() {
  act(() => { fireEvent.click(screen.getAllByText('On date')[0]!) })
  const trigger = Array.from(document.querySelectorAll('button'))
    .find(b => b.textContent?.includes('Select date'))
  expect(trigger).toBeTruthy()
  act(() => { fireEvent.click(trigger!) })
  expect(isOpen('Date')).toBe(true)
}

describe('DialogStack Escape handling', () => {
  it('closes the dialog on Escape', () => {
    openRepeatDialog()

    pressEscape()

    expect(isOpen('Repeat')).toBe(false)
  })

  // Regression: a document-level Escape listener in useEntryDialogs used to fire
  // alongside the nested dialog's own Radix handler, so one Escape tore down both
  // layers and dumped the user out of the repeat dialog they were still editing.
  it('closes only the topmost layer when a nested dialog is open', () => {
    openRepeatDialog()
    openNestedDatePicker()

    pressEscape()

    expect(isOpen('Date')).toBe(false)
    expect(isOpen('Repeat')).toBe(true)
  })
})
