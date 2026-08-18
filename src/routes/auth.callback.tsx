import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  completeGitHubSignIn, fetchInstalledRepos, addGitHubVaultOAuth, reauthGitHubVault,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
  type InstalledRepo, type OAuthTokens,
} from '@/vaultActions'
import { Button } from '@/components/ui/button'
import { useStore } from '@/store'

/**
 * Resolves once `restoreVaults()` (kicked off by the root route on every page
 * load, this one included) has populated `store.vaults` — or immediately if
 * it already has. The reconnect branch below looks a vault up by id, and
 * landing back here from the GitHub redirect is itself a fresh page load, so
 * without this wait the lookup would race an empty, not-yet-restored list and
 * misread a real vault as "no longer registered".
 */
function waitForVaultsLoaded(): Promise<void> {
  if (!useStore.getState().vaultLoading) return Promise.resolve()
  return new Promise(resolve => {
    const unsubscribe = useStore.subscribe(state => {
      if (!state.vaultLoading) { unsubscribe(); resolve() }
    })
  })
}

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallbackPage,
  validateSearch: (s: Record<string, unknown>): { code?: string; state?: string; error?: string } => ({
    code:  typeof s.code === 'string' ? s.code : undefined,
    state: typeof s.state === 'string' ? s.state : undefined,
    error: typeof s.error === 'string' ? s.error : undefined,
  }),
})

type Phase =
  | { kind: 'exchanging' }
  | { kind: 'connecting' }
  | { kind: 'picking'; tokens: OAuthTokens; repos: InstalledRepo[] }
  | { kind: 'no-installations' }
  | { kind: 'reconnect-repo-missing'; owner: string; repo: string }
  | { kind: 'error'; message: string }

function CenteredMessage({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-lg font-medium">{title}</h1>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  )
}

function AuthCallbackPage() {
  // Explicit annotation (matches validateSearch above) rather than relying on
  // inference through the generated route tree: CI lints before the build
  // step regenerates routeTree.gen.ts, so Route.useSearch() would otherwise
  // resolve to an unregistered/unresolved type there.
  const search: { code?: string; state?: string; error?: string } = Route.useSearch()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>({ kind: 'exchanging' })
  const loadProgress = useStore(s => s.vaultLoadProgress)

  // The OAuth exchange runs exactly once against the params this page was
  // loaded with; `connect`/`reconnect` are hoisted declarations, so capturing
  // them here picks up the same closure the effect would have seen anyway.
  // Written as a mount ref rather than an exhaustive-deps suppression because
  // such a suppression makes the React Compiler skip optimizing the whole
  // component.
  const startRef = useRef({ search, connect, reconnect })

  useEffect(() => {
    const { search: mountSearch, connect: mountConnect, reconnect: mountReconnect } = startRef.current
    const params = new URLSearchParams()
    if (mountSearch.code) params.set('code', mountSearch.code)
    if (mountSearch.state) params.set('state', mountSearch.state)
    if (mountSearch.error) params.set('error', mountSearch.error)

    let cancelled = false
    completeGitHubSignIn(params)
      .then(async tokens => {
        if (tokens.reconnectVaultId) {
          await mountReconnect(tokens.reconnectVaultId, tokens)
          return
        }
        const repos = await fetchInstalledRepos(tokens.accessToken)
        if (cancelled) return
        if (repos.length === 0) setPhase({ kind: 'no-installations' })
        else if (repos.length === 1) await mountConnect(tokens, repos[0]!)
        else setPhase({ kind: 'picking', tokens, repos })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message = e instanceof OAuthCallbackError ? e.message : 'Something went wrong finishing sign-in.'
        setPhase({ kind: 'error', message })
      })
    return () => { cancelled = true }
  }, [])

  /**
   * Re-authenticates an existing vault instead of adding a new one. Requires
   * the vault's own `owner/repo` to still be in the freshly signed-in
   * account's installed repos before saving anything — this is what stops a
   * sign-in as a *different* GitHub account from writing that account's
   * tokens onto this vault.
   */
  async function reconnect(vaultId: string, tokens: OAuthTokens) {
    await waitForVaultsLoaded()
    const vault = useStore.getState().vaults.find(v => v.id === vaultId)

    if (!vault || vault.kind !== 'github') {
      // The vault was removed (or is no longer GitHub-backed) between the
      // reconnect click and this redirect landing — fall through to the
      // ordinary add flow instead of dead-ending.
      const repos = await fetchInstalledRepos(tokens.accessToken)
      if (repos.length === 0) setPhase({ kind: 'no-installations' })
      else if (repos.length === 1) await connect(tokens, repos[0]!)
      else setPhase({ kind: 'picking', tokens, repos })
      return
    }

    const repos = await fetchInstalledRepos(tokens.accessToken)
    const stillInstalled = repos.some(r => r.owner === vault.github.owner && r.repo === vault.github.repo)
    if (!stillInstalled) {
      setPhase({ kind: 'reconnect-repo-missing', owner: vault.github.owner, repo: vault.github.repo })
      return
    }

    setPhase({ kind: 'connecting' })
    await reauthGitHubVault(vaultId, tokens)
    void navigate({ to: '/' })
  }

  async function connect(tokens: OAuthTokens, repo: InstalledRepo) {
    setPhase({ kind: 'connecting' })
    await addGitHubVaultOAuth({
      owner:        repo.owner,
      repo:         repo.repo,
      branch:       repo.branch,
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt:    tokens.expiresAt,
    })
    void navigate({ to: '/' })
  }

  if (phase.kind === 'exchanging') return <CenteredMessage title="Finishing sign-in…" />
  if (phase.kind === 'connecting') {
    return (
      <CenteredMessage
        title="Connecting…"
        description={loadProgress ? `Loaded ${loadProgress.loaded} of ${loadProgress.total} files` : undefined}
      />
    )
  }

  if (phase.kind === 'error') {
    return (
      <CenteredMessage title="Sign-in failed" description={phase.message}>
        <Button onClick={() => navigate({ to: '/' })}>Back to Meridian</Button>
      </CenteredMessage>
    )
  }

  if (phase.kind === 'no-installations') {
    return (
      <CenteredMessage
        title="Install Meridian on a repository"
        description="You're signed in, but the app isn't installed on any repository yet. Install it, then come back and sign in again."
      >
        <Button asChild>
          <a href={GITHUB_APP_INSTALL_URL}>Install on GitHub</a>
        </Button>
      </CenteredMessage>
    )
  }

  if (phase.kind === 'reconnect-repo-missing') {
    return (
      <CenteredMessage
        title="Repository not available"
        description={`You're signed in, but Meridian's GitHub App can't reach ${phase.owner}/${phase.repo} anymore. Check the App's repository access, then come back and sign in again.`}
      >
        <Button asChild>
          <a href={GITHUB_APP_INSTALL_URL}>Configure on GitHub</a>
        </Button>
      </CenteredMessage>
    )
  }

  return (
    <CenteredMessage title="Choose a repository">
      <div className="flex w-full max-w-sm flex-col gap-2">
        {phase.repos.map(repo => (
          <button
            key={`${repo.owner}/${repo.repo}`}
            onClick={() => connect(phase.tokens, repo)}
            className="rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
          >
            {repo.owner}/{repo.repo}
          </button>
        ))}
      </div>
    </CenteredMessage>
  )
}
