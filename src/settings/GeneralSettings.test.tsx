// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode, AnchorHTMLAttributes } from 'react'
import { render, screen } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import GeneralSettings from './GeneralSettings'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children, ...rest }: {
    to: string
    params?: Record<string, string>
    children: ReactNode
  } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={Object.entries(params ?? {}).reduce((path, [k, v]) => path.replace(`$${k}`, v), to)} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'dracula', setTheme: vi.fn(), systemTheme: 'dark' }) }))
vi.mock('@/vaultActions', () => ({ setDefaultVault: vi.fn() }))

setupStore()

const GITHUB_VAULT: VaultRef = {
  id: 'gh-vault', name: 'Work', kind: 'github',
  github: { owner: 'acme', repo: 'notes', branch: 'main' },
}

describe('GeneralSettings — appearance row', () => {
  it('links to the appearance screen and names the active theme', () => {
    render(<GeneralSettings />)

    const link = screen.getByRole('link', { name: /Appearance/ })
    expect(link).toHaveAttribute('href', '/settings/appearance')
    expect(link).toHaveTextContent('Dracula')
  })
})

describe('GeneralSettings — default vault picker', () => {
  it('is hidden when no vault can receive a new entry', () => {
    useStore.setState({
      vaults: [{ id: 'ical', name: 'Team', kind: 'ical', ical: { url: 'https://e.com/f.ics' } }],
    })
    render(<GeneralSettings />)

    expect(screen.queryByText('New entries go to')).not.toBeInTheDocument()
  })

  it('appears once a writable vault exists', () => {
    useStore.setState({ vaults: [GITHUB_VAULT], defaultVaultId: GITHUB_VAULT.id })
    render(<GeneralSettings />)

    expect(screen.getByText('New entries go to')).toBeInTheDocument()
    // The closed trigger renders the selected vault's label.
    expect(screen.getByRole('combobox')).toHaveTextContent('Work')
  })
})
