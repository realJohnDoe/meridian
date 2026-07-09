// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, fireEvent } from '@testing-library/react'
import { useEntryDialogs } from './useEntryDialogs'
import { ENTRY_DEFAULT } from './state'
import type { EntryState } from './state'

function setup(entry: EntryState = ENTRY_DEFAULT) {
  const updateEntry = vi.fn()
  const { result } = renderHook(() => useEntryDialogs(entry, updateEntry))
  return { result, updateEntry }
}

describe('useEntryDialogs', () => {
  it('opens a dialog by id and closes it via onClose', () => {
    const { result } = setup()
    act(() => result.current.handleOpenDlg('dlgDate'))
    expect(result.current.dialogHandlers.activeDialog).toBe('dlgDate')

    act(() => result.current.dialogHandlers.onClose())
    expect(result.current.dialogHandlers.activeDialog).toBeNull()
  })

  it('handleOpenRepeatDlg always opens the repeat dialog', () => {
    const { result } = setup()
    act(() => result.current.handleOpenRepeatDlg())
    expect(result.current.dialogHandlers.activeDialog).toBe('dlgRepeat')
  })

  it('closes the active dialog on Escape', () => {
    const { result } = setup()
    act(() => result.current.handleOpenDlg('dlgDate'))
    expect(result.current.dialogHandlers.activeDialog).toBe('dlgDate')

    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(result.current.dialogHandlers.activeDialog).toBeNull()
  })

  it('ignores non-Escape keys', () => {
    const { result } = setup()
    act(() => result.current.handleOpenDlg('dlgDate'))

    act(() => { fireEvent.keyDown(document, { key: 'Enter' }) })
    expect(result.current.dialogHandlers.activeDialog).toBe('dlgDate')
  })

  it('handleDateRemove clears both scheduled and duration, then closes the dialog', () => {
    const entry: EntryState = { ...ENTRY_DEFAULT, scheduled: { date: '2026-06-15', time: '09:00' }, duration: '1h' }
    const { result, updateEntry } = setup(entry)
    act(() => result.current.handleOpenDlg('dlgDate'))

    act(() => result.current.dialogHandlers.onDateRemove())

    expect(updateEntry).toHaveBeenCalledWith(expect.objectContaining({ scheduled: null, duration: '' }))
    expect(result.current.dialogHandlers.activeDialog).toBeNull()
  })

  it('handleTimeConfirm is a no-op when the entry has no scheduled date', () => {
    const { result, updateEntry } = setup({ ...ENTRY_DEFAULT, scheduled: null })
    act(() => result.current.dialogHandlers.onTimeConfirm('10:30'))
    expect(updateEntry).not.toHaveBeenCalled()
  })

  it('handleTimeConfirm updates the time on an already-scheduled entry', () => {
    const entry: EntryState = { ...ENTRY_DEFAULT, scheduled: { date: '2026-06-15', time: '09:00' } }
    const { result, updateEntry } = setup(entry)
    act(() => result.current.dialogHandlers.onTimeConfirm('10:30'))
    expect(updateEntry).toHaveBeenCalledWith(expect.objectContaining({ scheduled: { date: '2026-06-15', time: '10:30' } }))
  })

  it('handlePriority sets the priority and closes the dialog', () => {
    const { result, updateEntry } = setup()
    act(() => result.current.handleOpenDlg('dlgPriority'))
    act(() => result.current.dialogHandlers.onPriority('high'))
    expect(updateEntry).toHaveBeenCalledWith(expect.objectContaining({ priority: 'high' }))
    expect(result.current.dialogHandlers.activeDialog).toBeNull()
  })

  it('setSeriesSheetConfig / handleDeleteClose drive the delete + series-sheet state', () => {
    const { result } = setup()
    act(() => result.current.setPendingDelete({ title: 'Note', onConfirm: () => {} }))
    expect(result.current.dialogHandlers.pendingDelete?.title).toBe('Note')

    act(() => result.current.dialogHandlers.onDeleteClose())
    expect(result.current.dialogHandlers.pendingDelete).toBeNull()
  })
})
