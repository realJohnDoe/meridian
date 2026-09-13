// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore, emptySyncStatus } from '@/store'
import { setupStore } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import VaultList from './VaultList'

// No router is mounted, so `Link` is stubbed as the anchor it renders, with
// `to`/`params` resolved into the href the assertions read.
vi.mock('@tanstack/react-router', async () => {
  const { linkStub } = await import('@/test-utils/router')
  return { Link: linkStub }
})

setupStore()

const GITHUB_VAULT: VaultRef = {
  id: 'gh-vault', name: 'Work', kind: 'github',
  github: { owner: 'acme', repo: 'notes', branch: 'main' },
}
const ICAL_VAULT: VaultRef = {
  id: 'ical-vault', name: 'Team calendar', kind: 'ical', ical: { url: 'https://example.com/f.ics' },
}

describe('VaultList', () => {
  it('links each vault to its own settings screen', () => {
    useStore.setState({ vaults: [GITHUB_VAULT, ICAL_VAULT] })
    render(<VaultList />)

    expect(screen.getByRole('link', { name: /Work/ })).toHaveAttribute('href', '/settings/vault/gh-vault')
    expect(screen.getByRole('link', { name: /Team calendar/ })).toHaveAttribute('href', '/settings/vault/ical-vault')
  })

  it('always offers the add-vault screen, so a vault-less install can still get one', () => {
    useStore.setState({ vaults: [] })
    render(<VaultList />)

    expect(screen.getByRole('link', { name: /Add vault/ })).toHaveAttribute('href', '/settings/vault/new')
  })

  it('says which vault new entries go to, so the list agrees with the picker above it', () => {
    useStore.setState({ vaults: [GITHUB_VAULT, ICAL_VAULT], defaultVaultId: GITHUB_VAULT.id })
    render(<VaultList />)

    expect(screen.getByRole('link', { name: /Work/ })).toHaveTextContent('Default')
    expect(screen.getByRole('link', { name: /Team calendar/ })).not.toHaveTextContent('Default')
  })

  it('surfaces a vault needing attention without having to open it', () => {
    useStore.setState({
      vaults: [GITHUB_VAULT],
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'reauth', message: 'x' },
      }]]),
    })
    render(<VaultList />)

    expect(screen.getByRole('link', { name: /Work/ })).toHaveTextContent('Signed out')
  })

  it('shows no attention pill once the vault is healthy', () => {
    useStore.setState({
      vaults: [GITHUB_VAULT],
      syncByVault: new Map([[GITHUB_VAULT.id, emptySyncStatus()]]),
    })
    render(<VaultList />)

    expect(screen.getByRole('link', { name: /Work/ })).not.toHaveTextContent('Signed out')
  })

  it('lists vaults alphabetically by name, regardless of registration order', () => {
    useStore.setState({ vaults: [GITHUB_VAULT, ICAL_VAULT] })
    render(<VaultList />)

    const links = screen.getAllByRole('link')
    expect(links.map(l => l.textContent)).toEqual([
      expect.stringContaining('Team calendar'),
      expect.stringContaining('Work'),
      expect.stringContaining('Add vault'),
    ])
  })

  it('distinguishes same-named vaults by their source', () => {
    useStore.setState({
      vaults: [
        GITHUB_VAULT,
        { ...GITHUB_VAULT, id: 'gh-2', github: { owner: 'me', repo: 'notes', branch: 'main' } },
      ],
    })
    render(<VaultList />)

    const links = screen.getAllByRole('link', { name: /Work/ })
    expect(links[0]).toHaveTextContent('acme/notes')
    expect(links[1]).toHaveTextContent('me/notes')
  })
})
