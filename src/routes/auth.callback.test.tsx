// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type * as ReactRouter from '@tanstack/react-router'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useStore } from '@/store'
import { setupStore } from '@/test-utils'

const { navigateMock, completeGitHubSignIn, fetchInstalledRepos, addGitHubVaultOAuth, searchMock, OAuthCallbackError } =
  vi.hoisted(() => ({
    navigateMock: vi.fn(),
    completeGitHubSignIn: vi.fn(),
    fetchInstalledRepos: vi.fn(),
    addGitHubVaultOAuth: vi.fn(),
    // Typed so the createFileRoute mock's useSearch does not return `any`.
    searchMock: vi.fn<() => { code?: string; state?: string; error?: string }>(),
    // Must be the same class the component checks with `instanceof`, so it is
    // defined here and re-exported by the mock rather than imported.
    OAuthCallbackError: class OAuthCallbackError extends Error {},
  }))

// createFileRoute is mocked so the page component and validateSearch are
// reachable without standing up a router: the real Route is bound to the
// generated route tree, and Route.useSearch() needs router context.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactRouter>()
  return {
    ...actual,
    useNavigate: () => navigateMock,
    createFileRoute: () => (opts: Record<string, unknown>) => ({ ...opts, useSearch: () => searchMock() }),
  }
})

vi.mock('@/vaultActions', () => ({
  completeGitHubSignIn,
  fetchInstalledRepos,
  addGitHubVaultOAuth,
  OAuthCallbackError,
  GITHUB_APP_INSTALL_URL: 'https://github.com/apps/test-app/installations/new',
}))

// The createFileRoute mock hands back the plain options object at runtime, but
// the static type still describes the real Route, which exposes neither
// `component` nor `validateSearch`. Re-describe it for the type checker.
const { Route } = await import('./auth.callback')
const routeOptions = Route as unknown as {
  component: () => React.ReactElement
  validateSearch: (s: Record<string, unknown>) => { code?: string; state?: string; error?: string }
}
const AuthCallbackPage = routeOptions.component

const TOKENS = { accessToken: 'at', refreshToken: 'rt', expiresAt: 1_800_000 }
const repo = (name: string) => ({ owner: 'acme', repo: name, branch: 'main' })

// Never resolves — holds the page in whichever phase precedes it.
const pending = () => new Promise<never>(() => {})

setupStore()

beforeEach(() => {
  vi.clearAllMocks()
  searchMock.mockReturnValue({ code: 'abc', state: 'xyz' })
  addGitHubVaultOAuth.mockResolvedValue(undefined)
})

describe('auth.callback — validateSearch', () => {
  const validate = routeOptions.validateSearch

  it('passes through string code, state and error', () => {
    expect(validate({ code: 'c', state: 's', error: 'e' })).toEqual({ code: 'c', state: 's', error: 'e' })
  })

  it('drops non-string values rather than forwarding them to the token exchange', () => {
    expect(validate({ code: 42, state: null, error: { nested: true } })).toEqual({
      code: undefined, state: undefined, error: undefined,
    })
  })

  it('yields all-undefined for an empty search', () => {
    expect(validate({})).toEqual({ code: undefined, state: undefined, error: undefined })
  })
})

describe('auth.callback — exchanging', () => {
  it('shows progress while the code is being exchanged', () => {
    completeGitHubSignIn.mockReturnValue(pending())
    render(<AuthCallbackPage />)
    expect(screen.getByText('Finishing sign-in…')).toBeInTheDocument()
  })

  it('forwards code, state and error from the URL to the exchange', async () => {
    searchMock.mockReturnValue({ code: 'the-code', state: 'the-state', error: 'the-error' })
    completeGitHubSignIn.mockReturnValue(pending())
    render(<AuthCallbackPage />)

    await waitFor(() => expect(completeGitHubSignIn).toHaveBeenCalled())
    const params = completeGitHubSignIn.mock.calls[0]![0] as URLSearchParams
    expect(params.get('code')).toBe('the-code')
    expect(params.get('state')).toBe('the-state')
    expect(params.get('error')).toBe('the-error')
  })

  it('omits absent search keys entirely instead of sending empty values', async () => {
    searchMock.mockReturnValue({ code: 'the-code' })
    completeGitHubSignIn.mockReturnValue(pending())
    render(<AuthCallbackPage />)

    await waitFor(() => expect(completeGitHubSignIn).toHaveBeenCalled())
    const params = completeGitHubSignIn.mock.calls[0]![0] as URLSearchParams
    expect(params.has('state')).toBe(false)
    expect(params.has('error')).toBe(false)
  })
})

describe('auth.callback — repository fan-out', () => {
  it('connects immediately and goes home when exactly one repo is installed', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockResolvedValue([repo('notes')])
    render(<AuthCallbackPage />)

    await waitFor(() => expect(addGitHubVaultOAuth).toHaveBeenCalledTimes(1))
    expect(addGitHubVaultOAuth).toHaveBeenCalledWith({
      owner: 'acme', repo: 'notes', branch: 'main',
      accessToken: 'at', refreshToken: 'rt', expiresAt: 1_800_000,
    })
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/' }))
  })

  it('offers a picker without connecting anything when several repos are installed', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockResolvedValue([repo('notes'), repo('journal')])
    render(<AuthCallbackPage />)

    expect(await screen.findByText('Choose a repository')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'acme/notes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'acme/journal' })).toBeInTheDocument()
    expect(addGitHubVaultOAuth).not.toHaveBeenCalled()
  })

  it('connects the repo picked from the list', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockResolvedValue([repo('notes'), repo('journal')])
    render(<AuthCallbackPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'acme/journal' }))

    await waitFor(() => expect(addGitHubVaultOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'journal', accessToken: 'at' }),
    ))
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/' }))
  })

  // Signed in but the GitHub App isn't installed anywhere — a dead end unless
  // the user is sent to the install page, so this must not read as an error.
  it('sends the user to the install page when no repos are installed', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockResolvedValue([])
    render(<AuthCallbackPage />)

    expect(await screen.findByText('Install Meridian on a repository')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Install on GitHub' }))
      .toHaveAttribute('href', 'https://github.com/apps/test-app/installations/new')
    expect(addGitHubVaultOAuth).not.toHaveBeenCalled()
  })

  it('fetches the repo list with the freshly exchanged access token', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockResolvedValue([])
    render(<AuthCallbackPage />)

    await waitFor(() => expect(fetchInstalledRepos).toHaveBeenCalledWith('at'))
  })
})

describe('auth.callback — connecting', () => {
  it('reports vault load progress while connecting', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockResolvedValue([repo('notes')])
    addGitHubVaultOAuth.mockReturnValue(pending())
    useStore.setState({ vaultLoadProgress: { loaded: 12, total: 40 } })
    render(<AuthCallbackPage />)

    expect(await screen.findByText('Connecting…')).toBeInTheDocument()
    expect(await screen.findByText('Loaded 12 of 40 files')).toBeInTheDocument()
  })

  it('omits the progress line until the first count arrives', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockResolvedValue([repo('notes')])
    addGitHubVaultOAuth.mockReturnValue(pending())
    render(<AuthCallbackPage />)

    expect(await screen.findByText('Connecting…')).toBeInTheDocument()
    expect(screen.queryByText(/Loaded/)).not.toBeInTheDocument()
  })
})

describe('auth.callback — failure', () => {
  // OAuthCallbackError carries a message written for the user (bad state,
  // expired code, …); anything else is an internal failure whose message
  // should not be surfaced verbatim.
  it('surfaces an OAuthCallbackError message as-is', async () => {
    completeGitHubSignIn.mockRejectedValue(new OAuthCallbackError('That sign-in link has expired.'))
    render(<AuthCallbackPage />)

    expect(await screen.findByText('Sign-in failed')).toBeInTheDocument()
    expect(screen.getByText('That sign-in link has expired.')).toBeInTheDocument()
  })

  it('replaces an unexpected error with a generic message', async () => {
    completeGitHubSignIn.mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED 10.0.0.1'))
    render(<AuthCallbackPage />)

    expect(await screen.findByText('Sign-in failed')).toBeInTheDocument()
    expect(screen.getByText('Something went wrong finishing sign-in.')).toBeInTheDocument()
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument()
  })

  it('also fails cleanly when the repo fetch is what rejected', async () => {
    completeGitHubSignIn.mockResolvedValue(TOKENS)
    fetchInstalledRepos.mockRejectedValue(new OAuthCallbackError('Could not list repositories.'))
    render(<AuthCallbackPage />)

    expect(await screen.findByText('Could not list repositories.')).toBeInTheDocument()
  })

  it('offers a way back to the app', async () => {
    completeGitHubSignIn.mockRejectedValue(new OAuthCallbackError('nope'))
    render(<AuthCallbackPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Back to Meridian' }))

    expect(navigateMock).toHaveBeenCalledWith({ to: '/' })
  })

  // The effect's `cancelled` guard. Deliberately uses the single-repo case:
  // that is the one path where an unguarded continuation would go on to
  // connect a vault and navigate after the page is gone. With zero repos the
  // assertion would hold whether or not the guard existed.
  it('abandons the flow when unmounted mid-exchange', async () => {
    let resolve!: (v: typeof TOKENS) => void
    completeGitHubSignIn.mockReturnValue(new Promise(r => { resolve = r }))
    fetchInstalledRepos.mockResolvedValue([repo('notes')])
    const { unmount } = render(<AuthCallbackPage />)

    unmount()
    resolve(TOKENS)

    // The chain still runs as far as the repo fetch — the guard sits after it —
    // so waiting on that call is what proves the continuation was reached and
    // stopped, rather than simply never having started.
    await waitFor(() => expect(fetchInstalledRepos).toHaveBeenCalled())
    expect(addGitHubVaultOAuth).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
