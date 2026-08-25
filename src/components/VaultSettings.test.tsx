// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useStore, emptySyncStatus } from '@/store'
import { setupStore } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import { VaultSettings } from './VaultSettings'

setupStore()

const GITHUB_VAULT: VaultRef = {
  id: 'gh-vault', name: 'Work', kind: 'github',
  github: { owner: 'acme', repo: 'notes', branch: 'main' },
}

describe('VaultSettings — export', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('downloads the vault as a sanitized-filename .ics via an object URL', async () => {
    // jsdom has no real Blob-URL machinery; stub just enough to observe the download.
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<VaultSettings vault={{ ...GITHUB_VAULT, name: 'Work/Life: 2026' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Export \.ics/ }))

    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const [blob] = createObjectURL.mock.calls[0]!
    expect(blob.type).toBe('text/calendar;charset=utf-8')
    expect(await blob.text()).toContain('BEGIN:VCALENDAR')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock')

    const [a] = click.mock.instances as [HTMLAnchorElement]
    expect(a.download).toBe('Work-Life- 2026.ics')
  })
})

describe('VaultSettings — GitHub attention rows', () => {
  it('renders a reauth row that offers to sign in again', () => {
    useStore.setState({
      syncByVault: new Map([[GITHUB_VAULT.id, {
        ...emptySyncStatus(),
        needsAttention: { kind: 'reauth', message: 'x' },
      }]]),
    })
    render(<VaultSettings vault={GITHUB_VAULT} />)

    expect(screen.getByRole('button', { name: /Signed out of GitHub — sign in again/ })).toBeInTheDocument()
  })

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
