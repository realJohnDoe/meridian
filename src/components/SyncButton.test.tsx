// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore, emptySyncStatus } from '@/store'
import { setupStore } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import SyncButton from './SyncButton'

const { reconnectVault, requestVaultSettings } = vi.hoisted(() => ({
  reconnectVault: vi.fn(),
  requestVaultSettings: vi.fn(),
}))

vi.mock('@/vaultActions', () => ({
  syncToBackend: vi.fn(),
  reconnectVault,
  GITHUB_APP_INSTALL_URL: 'https://github.com/apps/test-app/installations/new',
}))

vi.mock('./vaultSettingsRequest', () => ({ requestVaultSettings }))

setupStore()

const LOCAL_VAULT: VaultRef = { id: 'local-vault', name: 'Family', kind: 'local' }
const GITHUB_VAULT: VaultRef = {
  id: 'gh-vault', name: 'Work', kind: 'github',
  github: { owner: 'acme', repo: 'notes', branch: 'main' },
}

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: 'Sync status' }))
}

describe('SyncButton — attention rows', () => {
  it('renders the fs-permission row and reconnects on click', () => {
    useStore.setState({
      vaults: [LOCAL_VAULT],
      syncByVault: new Map([[LOCAL_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'fs-permission', message: 'x' },
      }]]),
    })
    render(<SyncButton />)
    openPopover()

    fireEvent.click(screen.getByRole('button', { name: /Permission needed/ }))
    expect(reconnectVault).toHaveBeenCalledWith(LOCAL_VAULT.id)
  })

  it('renders the reauth row disabled, with no wired action yet', () => {
    useStore.setState({
      vaults: [GITHUB_VAULT],
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'reauth', message: 'x' },
      }]]),
    })
    render(<SyncButton />)
    openPopover()

    const row = screen.getByText('Signed out of GitHub — sign in again')
    expect(row.closest('button')).toBeDisabled()
  })

  it('renders the access row as a link to the App install page', () => {
    useStore.setState({
      vaults: [GITHUB_VAULT],
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'access', message: 'x' },
      }]]),
    })
    render(<SyncButton />)
    openPopover()

    const link = screen.getByRole('link', { name: /Meridian no longer has access to acme\/notes/ })
    expect(link).toHaveAttribute('href', 'https://github.com/apps/test-app/installations/new')
  })

  it('renders the config row and requests Settings for that vault on click', () => {
    useStore.setState({
      vaults: [GITHUB_VAULT],
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'config', message: 'x' },
      }]]),
    })
    render(<SyncButton />)
    openPopover()

    fireEvent.click(screen.getByRole('button', { name: /acme\/notes \(main\) isn.t reachable/ }))
    expect(requestVaultSettings).toHaveBeenCalledWith(GITHUB_VAULT.id)
  })
})
