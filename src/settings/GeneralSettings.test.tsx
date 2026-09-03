// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import type { ReactNode, AnchorHTMLAttributes } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('GeneralSettings — locale preferences', () => {
  it('writes the chosen first day of week through to the store', () => {
    useStore.setState({ localePrefs: { hour12: false, firstDayOfWeek: 1 } })
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('radio', { name: 'Sunday' }))

    expect(useStore.getState().localePrefs.firstDayOfWeek).toBe(7)
  })

  it('leaves the other locale preference alone when one changes', () => {
    useStore.setState({ localePrefs: { hour12: true, firstDayOfWeek: 1 } })
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('radio', { name: 'Saturday' }))

    expect(useStore.getState().localePrefs).toEqual({ hour12: true, firstDayOfWeek: 6 })
  })

  it('switches the time format', () => {
    useStore.setState({ localePrefs: { hour12: false, firstDayOfWeek: 1 } })
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('radio', { name: '12-hour' }))

    expect(useStore.getState().localePrefs.hour12).toBe(true)
  })

  it('ignores a re-press that would clear the group, since no first day is unrenderable', () => {
    useStore.setState({ localePrefs: { hour12: false, firstDayOfWeek: 1 } })
    render(<GeneralSettings />)

    // Radix toggle groups deselect on re-press; the handler must swallow that.
    fireEvent.click(screen.getByRole('radio', { name: 'Monday' }))

    expect(useStore.getState().localePrefs.firstDayOfWeek).toBe(1)
  })
})

describe('GeneralSettings — occurrence coloring', () => {
  it('writes the chosen color source through to the store', () => {
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('radio', { name: 'Vault' }))
    expect(useStore.getState().colorBy).toBe('vault')

    fireEvent.click(screen.getByRole('radio', { name: 'Type' }))
    expect(useStore.getState().colorBy).toBe('type')
  })

  it('ignores a re-press that would clear the group — there is no third mode', () => {
    useStore.setState({ colorBy: 'vault' })
    render(<GeneralSettings />)

    fireEvent.click(screen.getByRole('radio', { name: 'Vault' }))

    expect(useStore.getState().colorBy).toBe('vault')
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
