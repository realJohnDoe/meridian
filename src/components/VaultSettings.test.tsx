// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore, emptySyncStatus } from '@/store'
import { setupStore } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import { VaultSettings } from './VaultSettings'

setupStore()

const GITHUB_VAULT: VaultRef = {
  id: 'gh-vault', name: 'Work', kind: 'github',
  github: { owner: 'acme', repo: 'notes', branch: 'main' },
}

describe('VaultSettings — GitHub attention rows', () => {
  it('mirrors the access row as a link to the App install page', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'access', message: 'x' },
      }]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    const link = screen.getByRole('link', { name: /Meridian no longer has access to acme\/notes/ })
    expect(link).toHaveAttribute('href', expect.stringContaining('github.com/apps/'))
  })

  it('mirrors the config row as plain informational text', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'config', message: 'x' },
      }]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    expect(screen.getByText(/acme\/notes \(main\) isn.t reachable/)).toBeInTheDocument()
  })

  it('shows neither row once needsAttention clears', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, emptySyncStatus()]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    expect(screen.queryByText(/no longer has access/)).not.toBeInTheDocument()
    expect(screen.queryByText(/isn.t reachable/)).not.toBeInTheDocument()
  })
})
