// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore } from '@/test-utils'
import type { VaultRef } from '@/vaultRef'
import CoachTour from './CoachTour'
import { isTourDone, markTourDone } from './tourState'

setupStore()

beforeEach(() => {
  localStorage.clear()
})

const REAL_VAULT: VaultRef = { id: 'v1', name: 'Real', kind: 'local' }

/**
 * `useResetOnChange` only fires on a change from the previously rendered
 * value, never on mount — so the tour needs `hasRealVault` to actually flip
 * from true to false after mount to auto-start. Mounts with a real vault
 * registered, then drops it, mirroring the "last vault removed" transition
 * the hook is built to catch.
 */
function mountAndDropVault() {
  useStore.setState({ vaults: [REAL_VAULT] })
  const setSidebarOpen = vi.fn()
  const navigateHome = vi.fn()
  render(<CoachTour setSidebarOpen={setSidebarOpen} navigateHome={navigateHome} />)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  act(() => { useStore.setState({ vaults: [] }) })
  return { setSidebarOpen, navigateHome }
}

describe('CoachTour', () => {
  it('stays hidden while a real vault is registered', () => {
    useStore.setState({ vaults: [REAL_VAULT] })
    render(<CoachTour setSidebarOpen={vi.fn()} navigateHome={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('does not restart once the tour was already dismissed, even after the last real vault is dropped', () => {
    markTourDone()
    useStore.setState({ vaults: [REAL_VAULT] })
    render(<CoachTour setSidebarOpen={vi.fn()} navigateHome={vi.fn()} />)

    act(() => { useStore.setState({ vaults: [] }) })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('auto-starts on the first step once no real vault remains and the tour is undone', async () => {
    const { setSidebarOpen, navigateHome } = mountAndDropVault()

    expect(screen.getByRole('dialog', { name: /Welcome to Meridian/ })).toBeInTheDocument()
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
    await waitFor(() => { expect(setSidebarOpen).toHaveBeenCalledWith(false) })
    expect(navigateHome).toHaveBeenCalled()
  })

  it('advances through steps with Next and back up with Back, disabling Back on the first step', () => {
    mountAndDropVault()

    expect(screen.getByRole('button', { name: '← Back' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.getByText('2 / 4')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '← Back' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: '← Back' }))
    expect(screen.getByText('1 / 4')).toBeInTheDocument()
  })

  it('shows Done instead of Next on the last step, and Done dismisses the tour', () => {
    const { setSidebarOpen, navigateHome } = mountAndDropVault()

    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.getByText('4 / 4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(setSidebarOpen).toHaveBeenCalledWith(false)
    expect(navigateHome).toHaveBeenCalled()
    expect(isTourDone()).toBe(true)
  })

  it('traps Tab inside the card so the tour cannot be tabbed out of', () => {
    mountAndDropVault()

    // The card takes focus when the tour starts, and Back is disabled on step
    // 1, so the trapped range is Skip → Next.
    const card = screen.getByRole('dialog')
    expect(document.activeElement).toBe(card)

    const next = screen.getByRole('button', { name: 'Next →' })
    next.focus()
    fireEvent.keyDown(next, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Skip tour' }))
  })

  it('marks the card as a modal dialog', () => {
    mountAndDropVault()

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })

  it('Escape dismisses the tour', () => {
    mountAndDropVault()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(isTourDone()).toBe(true)
  })

  it('Skip dismisses the tour from any step', () => {
    mountAndDropVault()

    fireEvent.click(screen.getByRole('button', { name: 'Skip tour' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(isTourDone()).toBe(true)
  })
})
