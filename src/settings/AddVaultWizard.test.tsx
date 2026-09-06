// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore } from '@/test-utils'
import type * as VaultActions from '@/vaultActions'
import { addLocalVault, addExampleVault, addIcalVault, startGitHubSignIn, previewIcalFeed } from '@/vaultActions'
import AddVaultWizard from './AddVaultWizard'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

// isFolderPickerSupported and GITHUB_APP_INSTALL_URL stay real — the former is
// driven by stubbing window.showDirectoryPicker directly (see
// setFolderPickerSupported below), per its own doc comment: it's read fresh
// during render specifically so a module-scope fake wouldn't exercise the
// branch it thinks it does.
vi.mock('@/vaultActions', async (importOriginal) => ({
  ...(await importOriginal<typeof VaultActions>()),
  addLocalVault: vi.fn(),
  addExampleVault: vi.fn(),
  addIcalVault: vi.fn(),
  startGitHubSignIn: vi.fn(() => Promise.resolve()),
  previewIcalFeed: vi.fn(),
}))

setupStore()

function setFolderPickerSupported(supported: boolean) {
  const win = window as unknown as { showDirectoryPicker?: () => void }
  if (supported) win.showDirectoryPicker = () => {}
  else delete win.showDirectoryPicker
}

afterEach(() => {
  vi.clearAllMocks()
  setFolderPickerSupported(false)
})

describe('AddVaultWizard — source step', () => {
  it('offers GitHub, iCal and Tutorial cards, hiding Local when the folder picker is unsupported', () => {
    render(<AddVaultWizard />)

    expect(screen.getByRole('button', { name: /GitHub repository/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Calendar subscription/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tutorial vault/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Local folder/ })).not.toBeInTheDocument()
  })

  it('offers a Local folder card once the folder picker is supported', () => {
    setFolderPickerSupported(true)
    render(<AddVaultWizard />)

    expect(screen.getByRole('button', { name: /Local folder/ })).toBeInTheDocument()
  })

  it('omits the Tutorial card once an example vault already exists', () => {
    useStore.setState({ vaults: [{ id: 'example', name: 'Tutorial', kind: 'example' }] })
    render(<AddVaultWizard />)

    expect(screen.queryByRole('button', { name: /Tutorial vault/ })).not.toBeInTheDocument()
  })

  it('defaults to GitHub selected', () => {
    render(<AddVaultWizard />)

    expect(screen.getByRole('button', { name: /GitHub repository/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument()
  })

  it('marks whichever card is clicked pressed, and no other', () => {
    render(<AddVaultWizard />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar subscription/ }))

    expect(screen.getByRole('button', { name: /Calendar subscription/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /GitHub repository/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('advances to the github step on Next when GitHub is selected', () => {
    render(<AddVaultWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Connect a GitHub repository')).toBeInTheDocument()
  })

  it('advances to the ical step on Next when the calendar source is selected', () => {
    render(<AddVaultWizard />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar subscription/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Subscribe to a calendar')).toBeInTheDocument()
  })

  it('adds the local vault and navigates away immediately when Local is chosen', async () => {
    setFolderPickerSupported(true)
    render(<AddVaultWizard />)
    fireEvent.click(screen.getByRole('button', { name: /Local folder/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Choose folder' })); await Promise.resolve() })

    expect(navigate).toHaveBeenCalledWith({ to: '/settings' })
    expect(addLocalVault).toHaveBeenCalledTimes(1)
  })

  it('adds the example vault and navigates away immediately when Tutorial is chosen', async () => {
    render(<AddVaultWizard />)
    fireEvent.click(screen.getByRole('button', { name: /Tutorial vault/ }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); await Promise.resolve() })

    expect(navigate).toHaveBeenCalledWith({ to: '/settings' })
    expect(addExampleVault).toHaveBeenCalledTimes(1)
  })
})

describe('AddVaultWizard — iCal step', () => {
  function goToIcalStep() {
    render(<AddVaultWizard />)
    fireEvent.click(screen.getByRole('button', { name: /Calendar subscription/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }

  it('disables "Check calendar" until an address is entered', () => {
    goToIcalStep()
    expect(screen.getByRole('button', { name: 'Check calendar' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText(/calendar\.google\.com/), { target: { value: 'https://example.com/feed.ics' } })
    expect(screen.getByRole('button', { name: 'Check calendar' })).toBeEnabled()
  })

  it('previews the feed and seeds the name field from the result', async () => {
    vi.mocked(previewIcalFeed).mockResolvedValue({ name: 'Team Calendar', eventCount: 3 })
    goToIcalStep()

    fireEvent.change(screen.getByPlaceholderText(/calendar\.google\.com/), { target: { value: 'https://example.com/feed.ics' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check calendar' })); await Promise.resolve() })

    expect(previewIcalFeed).toHaveBeenCalledWith('https://example.com/feed.ics')
    expect(screen.getByText('Team Calendar')).toBeInTheDocument()
    expect(screen.getByText('3 events found')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Team Calendar')).toBeInTheDocument()
  })

  it('shows a friendly error when the feed cannot be read, and no preview', async () => {
    vi.mocked(previewIcalFeed).mockRejectedValue(new Error('Not found'))
    goToIcalStep()

    fireEvent.change(screen.getByPlaceholderText(/calendar\.google\.com/), { target: { value: 'https://example.com/feed.ics' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check calendar' })); await Promise.resolve() })

    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.queryByText(/events found/)).not.toBeInTheDocument()
  })

  it('adds the calendar with the (possibly edited) name and navigates away', async () => {
    vi.mocked(previewIcalFeed).mockResolvedValue({ eventCount: 0 })
    goToIcalStep()

    fireEvent.change(screen.getByPlaceholderText(/calendar\.google\.com/), { target: { value: 'https://example.com/feed.ics' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check calendar' })); await Promise.resolve() })

    fireEvent.change(screen.getByDisplayValue('Calendar'), { target: { value: 'Family' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add calendar' })); await Promise.resolve() })

    expect(navigate).toHaveBeenCalledWith({ to: '/settings' })
    expect(addIcalVault).toHaveBeenCalledWith('https://example.com/feed.ics', 'Family')
  })

  it('goes back to the source step', () => {
    goToIcalStep()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: /GitHub repository/ })).toBeInTheDocument()
  })
})

describe('AddVaultWizard — GitHub step', () => {
  function goToGitHubStep() {
    render(<AddVaultWizard />)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }

  it('links to the GitHub App install page in a new tab', () => {
    goToGitHubStep()
    const link = screen.getByRole('link', { name: 'Install the GitHub App' })

    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
  })

  it('starts GitHub sign-in and shows a disabled redirecting state', async () => {
    goToGitHubStep()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in with GitHub' })); await Promise.resolve() })

    expect(startGitHubSignIn).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Redirecting to GitHub…' })).toBeDisabled()
  })

  it('goes back to the source step', () => {
    goToGitHubStep()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: /GitHub repository/ })).toBeInTheDocument()
  })
})
