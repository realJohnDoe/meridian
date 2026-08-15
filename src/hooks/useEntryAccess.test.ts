// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore, makeOcc, TEST_VAULT } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import { useEntryAccess } from './useEntryAccess'

setupStore()

function setVault(vault: VaultRef) {
  useStore.setState({ vaults: [vault] })
}

describe('useEntryAccess', () => {
  it('is edit mode for a local vault', () => {
    setVault({ id: TEST_VAULT, name: 'Notes', kind: 'local' })
    const { result } = renderHook(() => useEntryAccess(makeOcc()))
    expect(result.current).toEqual({ mode: 'edit', vault: { id: TEST_VAULT, name: 'Notes', kind: 'local' } })
  })

  it('is edit mode for a github vault', () => {
    setVault({ id: TEST_VAULT, name: 'Repo', kind: 'github', github: { owner: 'a', repo: 'b', branch: 'main' } })
    const { result } = renderHook(() => useEntryAccess(makeOcc()))
    expect(result.current.mode).toBe('edit')
  })

  it('is sandbox mode for the Tutorial vault', () => {
    setVault({ id: TEST_VAULT, name: 'Tutorial', kind: 'example' })
    const { result } = renderHook(() => useEntryAccess(makeOcc()))
    expect(result.current.mode).toBe('sandbox')
  })

  it('is view-only mode for an iCal subscription', () => {
    setVault({ id: TEST_VAULT, name: 'Family', kind: 'ical', ical: { url: 'https://example.com/cal.ics' } })
    const { result } = renderHook(() => useEntryAccess(makeOcc()))
    expect(result.current.mode).toBe('view-only')
  })
})
