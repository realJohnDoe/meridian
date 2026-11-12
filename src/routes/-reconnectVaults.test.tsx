// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { setupStore } from '@/test-utils'
import { encodeHandoff } from '@/storage'

const { addIcalVault, startGitHubSignIn } = vi.hoisted(() => ({
  addIcalVault: vi.fn(() => Promise.resolve()),
  startGitHubSignIn: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/storage', async orig => ({ ...(await orig<Record<string, unknown>>()), addIcalVault, startGitHubSignIn }))
vi.mock('sonner', () => ({ toast: vi.fn() }))

import { ReconnectVaults } from './-reconnectVaults'

const hash = encodeHandoff([
  { id: 'a', name: 'acme/notes', kind: 'github', github: { owner: 'acme', repo: 'notes', branch: 'main' } },
  { id: 'c', name: 'Holidays', kind: 'ical', ical: { url: 'https://example.com/h.ics' } },
])

describe('ReconnectVaults', () => {
  beforeEach(() => { setupStore(); vi.clearAllMocks(); sessionStorage.clear() })

  it('offers the vaults, clears the fragment, and adds on confirm', async () => {
    window.location.hash = hash
    render(<ReconnectVaults />)
    expect(window.location.hash).toBe('')
    expect(screen.getByText('Reconnect these vaults?')).toBeTruthy()
    fireEvent.click(screen.getByText('Reconnect'))
    await waitFor(() => { expect(startGitHubSignIn).toHaveBeenCalled() })
    expect(addIcalVault).toHaveBeenCalledWith('https://example.com/h.ics', 'Holidays')
    expect(sessionStorage.getItem('meridian_pending_reconnect')).toBeTruthy()
  })

  it('adds nothing when declined', () => {
    window.location.hash = hash
    render(<ReconnectVaults />)
    fireEvent.click(screen.getByText('Not now'))
    expect(screen.queryByText('Reconnect these vaults?')).toBeNull()
    expect(addIcalVault).not.toHaveBeenCalled()
    expect(startGitHubSignIn).not.toHaveBeenCalled()
  })

  it('ignores a malformed fragment', () => {
    window.location.hash = '#reconnect=garbage!'
    render(<ReconnectVaults />)
    expect(window.location.hash).toBe('')
    expect(screen.queryByText('Reconnect these vaults?')).toBeNull()
  })
})
