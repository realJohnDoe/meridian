import { useEffect, useState, type ReactNode } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  completeGitHubSignIn, fetchInstalledRepos, addGitHubVaultOAuth,
  OAuthCallbackError, GITHUB_APP_INSTALL_URL,
  type InstalledRepo, type OAuthTokens,
} from '@/vaultActions'
import { Button } from '@/components/ui/button'

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
  | { kind: 'error'; message: string }

function CenteredMessage({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-[18px] font-medium">{title}</h1>
      {description && <p className="max-w-sm text-[13px] text-muted-foreground">{description}</p>}
      {children}
    </div>
  )
}

function AuthCallbackPage() {
  const search = Route.useSearch()
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>({ kind: 'exchanging' })

  useEffect(() => {
    const params = new URLSearchParams()
    if (search.code) params.set('code', search.code)
    if (search.state) params.set('state', search.state)
    if (search.error) params.set('error', search.error)

    let cancelled = false
    completeGitHubSignIn(params)
      .then(async tokens => {
        const repos = await fetchInstalledRepos(tokens.accessToken)
        if (cancelled) return
        if (repos.length === 0) setPhase({ kind: 'no-installations' })
        else if (repos.length === 1) await connect(tokens, repos[0])
        else setPhase({ kind: 'picking', tokens, repos })
      })
      .catch(e => {
        if (cancelled) return
        const message = e instanceof OAuthCallbackError ? e.message : 'Something went wrong finishing sign-in.'
        setPhase({ kind: 'error', message })
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  if (phase.kind === 'connecting') return <CenteredMessage title="Connecting…" />

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

  return (
    <CenteredMessage title="Choose a repository">
      <div className="flex w-full max-w-sm flex-col gap-2">
        {phase.repos.map(repo => (
          <button
            key={`${repo.owner}/${repo.repo}`}
            onClick={() => connect(phase.tokens, repo)}
            className="rounded-lg border border-border px-3 py-2 text-left text-[14px] transition-colors hover:bg-accent"
          >
            {repo.owner}/{repo.repo}
          </button>
        ))}
      </div>
    </CenteredMessage>
  )
}
