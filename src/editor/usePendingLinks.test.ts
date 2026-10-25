// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { entryKey } from '../fileIO'
import { usePendingLinks } from './usePendingLinks'

const inbox = entryKey('v1', 'inbox')
const elsewhere = entryKey('v2', 'inbox')

describe('usePendingLinks initialKeys', () => {
  it('starts a new entry on its default lists', () => {
    const { result } = renderHook(() => usePendingLinks(null, 'Draft', 'v1', null, [inbox]))
    expect(result.current.pendingKeys).toEqual([inbox])
  })

  it('lets the user take a default list off again', () => {
    const { result } = renderHook(() => usePendingLinks(null, 'Draft', 'v1', null, [inbox]))
    act(() => { result.current.handleRemove(inbox) })
    expect(result.current.pendingKeys).toEqual([])
  })

  it('swaps them for another vault\'s when the entry is retargeted', () => {
    const { result } = renderHook(() => usePendingLinks(null, 'Draft', 'v1', null, [inbox]))
    act(() => { result.current.resetPending([elsewhere]) })
    expect(result.current.pendingKeys).toEqual([elsewhere])
  })
})
