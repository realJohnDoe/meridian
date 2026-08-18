import { describe, it, expect, vi } from 'vitest'
import { requestVaultSettings, onVaultSettingsRequested } from './vaultSettingsRequest'

describe('vaultSettingsRequest', () => {
  it('notifies every subscriber with the requested vault id', () => {
    const fn = vi.fn()
    onVaultSettingsRequested(fn)
    requestVaultSettings('vault-a')
    expect(fn).toHaveBeenCalledWith('vault-a')
  })

  it('stops notifying once unsubscribed', () => {
    const fn = vi.fn()
    const unsubscribe = onVaultSettingsRequested(fn)
    unsubscribe()
    requestVaultSettings('vault-a')
    expect(fn).not.toHaveBeenCalled()
  })
})
