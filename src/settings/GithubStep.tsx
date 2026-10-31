import { useEffect, useState } from 'react'
import { Button } from '@/components/primitives/button'
import RepoPicker from './RepoPicker'
import { useStore } from '@/store'
import {
  addGitHubVaultOAuth, startGitHubSignIn, findReusableGitHubSession, fetchInstalledRepos,
  GITHUB_APP_INSTALL_URL, type ReusableGitHubSession, type InstalledRepo,
} from '@/vaultActions'

/**
 * The github step's own state machine, separate from `WizardStep` because it
 * has to run a check *before* deciding whether to show a sign-in button at
 * all: 'idle' until that check starts, 'checking' while it's in flight,
 * 'signed-out' once it comes up empty (no reusable session — show the button
 * as before), and 'picking'/'repos-error' once a reused session's repo list
 * either loaded or didn't.
 */
type GithubPhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'signed-out' }
  | { kind: 'picking'; session: ReusableGitHubSession; repos: InstalledRepo[] }
  | { kind: 'repos-error'; session: ReusableGitHubSession; message: string }
  | { kind: 'connecting' }

/** The GitHub step of the add-vault wizard. Mounts only on that step, so leaving it resets all state. */
export default function GithubStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [signingIn, setSigningIn] = useState(false)
  const hasGithubVault = useStore(s => s.vaults.some(v => v.kind === 'github'))
  const [githubPhase, setGithubPhase] = useState<GithubPhase>({ kind: hasGithubVault ? 'checking' : 'idle' })

  // Reused-sign-in check, run once per visit to this step. A GitHub App
  // user-access-token grant authorizes the account, not one repository, so
  // an existing GitHub vault's tokens are equally good for adding a second —
  // this is what lets the step skip startGitHubSignIn's full-page redirect
  // (and the confusing instant bounce through github.com it does when the
  // browser is already signed in there) whenever one is usable. Whether
  // there's anything to check (`hasGithubVault`) is derived state; only the
  // async lookup itself belongs in the effect.
  useEffect(() => {
    if (!hasGithubVault) return

    const githubVaultIds = useStore.getState().vaults.filter(v => v.kind === 'github').map(v => v.id)
    let cancelled = false
    findReusableGitHubSession(githubVaultIds)
      .then(async session => {
        if (!session) {
          if (!cancelled) setGithubPhase({ kind: 'signed-out' })
          return
        }
        try {
          const repos = await fetchInstalledRepos(session.accessToken)
          if (!cancelled) setGithubPhase({ kind: 'picking', session, repos })
        } catch (e) {
          if (!cancelled) {
            setGithubPhase({ kind: 'repos-error', session, message: e instanceof TypeError ? "Couldn't reach GitHub — check your connection." : e instanceof Error ? e.message : 'Could not load repositories.' })
          }
        }
      })
      .catch(() => { if (!cancelled) setGithubPhase({ kind: 'signed-out' }) })
    return () => { cancelled = true }
  }, [hasGithubVault])

  async function handleSignIn() {
    setSigningIn(true)
    await startGitHubSignIn() // full-page redirect on success — component unmounts
    setSigningIn(false) // only reached if sign-in failed and notified instead of redirecting
  }

  async function handleConnectRepo(session: ReusableGitHubSession, repo: InstalledRepo) {
    setGithubPhase({ kind: 'connecting' })
    onDone()
    await addGitHubVaultOAuth({
      owner:        repo.owner,
      repo:         repo.repo,
      branch:       repo.branch,
      accessToken:  session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt:    session.expiresAt,
    })
  }

  const installAppLink = (
    <a
      href={GITHUB_APP_INSTALL_URL}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      Install the GitHub App
    </a>
  )

  if (githubPhase.kind === 'connecting') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="px-1 text-sm font-semibold text-foreground">Connecting…</h2>
      </div>
    )
  }

  if (githubPhase.kind === 'picking' || githubPhase.kind === 'repos-error') {
    const { session } = githubPhase
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-0.5 px-1">
          <h2 className="text-sm font-semibold text-foreground">Connect a GitHub repository</h2>
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{session.login}</span>
          </p>
        </div>

        {githubPhase.kind === 'repos-error' && (
          <p className="px-1 text-xs text-destructive">{githubPhase.message}</p>
        )}
        {githubPhase.kind === 'picking' && githubPhase.repos.length === 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            Meridian isn&rsquo;t installed on any repository yet.
          </p>
        )}

        {/* Rendered on the error path too, with no list: its out-links — and
            the sign-in-again row in particular — are the way out of a repo
            fetch that failed, not just of one that came back empty. */}
        <RepoPicker
          repos={githubPhase.kind === 'picking' ? githubPhase.repos : []}
          onPick={repo => void handleConnectRepo(session, repo)}
          onSignInAgain={() => { void handleSignIn() }}
        />

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={signingIn}>Back</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="px-1 text-sm font-semibold text-foreground">Connect a GitHub repository</h2>

      {githubPhase.kind === 'checking'
        ? <p className="text-sm text-muted-foreground">Checking GitHub sign-in…</p>
        : (
          <Button onClick={handleSignIn} disabled={signingIn}>
            {signingIn ? 'Redirecting to GitHub…' : 'Sign in with GitHub'}
          </Button>
        )}
      <p className="text-xs text-muted-foreground">
        You&rsquo;ll need a GitHub repository with Meridian&rsquo;s app installed on it — you can
        create one and install the app after signing in.{' '}
        {installAppLink}
      </p>

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack} disabled={signingIn}>Back</Button>
      </div>
    </div>
  )
}
