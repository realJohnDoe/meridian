// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import VaultDetail from './VaultDetail'

// VaultDetail's own job is resolving $vaultId to a vault (or a loading/redirect
// state) — VaultSettings's own rendering is covered by VaultSettings.test.tsx,
// so it's stubbed here to a marker naming the vault it received.
vi.mock('./VaultSettings', () => ({
  VaultSettings: ({ vault }: { vault: VaultRef }) => <div data-testid="vault-settings">{vault.name}</div>,
}))

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}))

setupStore()

const VAULT: VaultRef = { id: 'v1', name: 'Notes', kind: 'local' }

describe('VaultDetail', () => {
  it('renders VaultSettings for a vault that exists', () => {
    useStore.setState({ vaults: [VAULT], vaultLoading: false })
    render(<VaultDetail vaultId="v1" />)

    expect(screen.getByTestId('vault-settings')).toHaveTextContent('Notes')
  })

  it('shows a loading skeleton while vaults are still loading and none matches yet', () => {
    useStore.setState({ vaults: [], vaultLoading: true })
    render(<VaultDetail vaultId="v1" />)

    expect(screen.queryByTestId('vault-settings')).not.toBeInTheDocument()
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  })

  it('redirects to /settings once loading has finished and no such vault exists', () => {
    useStore.setState({ vaults: [], vaultLoading: false })
    render(<VaultDetail vaultId="gone" />)

    expect(screen.getByTestId('navigate')).toHaveTextContent('/settings')
  })

  it('prefers the matching vault over the loading state', () => {
    useStore.setState({ vaults: [VAULT], vaultLoading: true })
    render(<VaultDetail vaultId="v1" />)

    expect(screen.getByTestId('vault-settings')).toHaveTextContent('Notes')
  })
})
