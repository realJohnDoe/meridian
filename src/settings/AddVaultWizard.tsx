import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { HardDrive, GitBranch, CalendarDays, BookOpen } from 'lucide-react'
import { Button } from '@/components/primitives/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import {
  addLocalVault, addIcalVault, addExampleVault, addGitHubVaultOAuth, startGitHubSignIn,
  findReusableGitHubSession, fetchInstalledRepos, isFolderPickerSupported,
  previewIcalFeed, GITHUB_APP_INSTALL_URL,
  type ReusableGitHubSession, type InstalledRepo,
} from '@/vaultActions'

type WizardStep = 'source' | 'github' | 'ical'
type Source = 'local' | 'github' | 'ical' | 'example'

const SOURCE_CARDS: { id: Source; Icon: typeof HardDrive; title: string; desc: string }[] = [
  {
    id:    'github',
    Icon:  GitBranch,
    title: 'GitHub repository',
    desc:  'Sign in with GitHub. Works on any device and browser.',
  },
  {
    id:    'local',
    Icon:  HardDrive,
    title: 'Local folder',
    desc:  'Use a folder on this device. Works in Chrome or Edge, desktop or Android; not available in Safari or Firefox.',
  },
  {
    id:    'ical',
    Icon:  CalendarDays,
    title: 'Calendar subscription',
    desc:  'Paste an iCal address from Google, Outlook, Apple or anywhere else. Read-only — its events appear alongside your own.',
  },
]

const TUTORIAL_CARD: { id: Source; Icon: typeof HardDrive; title: string; desc: string } = {
  id:    'example',
  Icon:  BookOpen,
  title: 'Tutorial vault',
  desc:  'Sample notes that show how Meridian works. Safe to remove once you have a vault of your own.',
}

/** What the validate step learned about a pasted feed URL. */
interface FeedPreview {
  name?:      string
  eventCount: number
}

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

/**
 * Adding a vault, on its own screen.
 *
 * It was previously a second `step` of the settings modal, which meant a
 * multi-step flow nested inside a surface already showing another one. As a
 * route it gets the room its source cards want, a real back button, and its
 * own entry in history — so a half-finished iCal subscription survives the
 * back gesture instead of dismissing the whole of Settings.
 */
export default function AddVaultWizard() {
  const navigate = useNavigate()

  const [step,      setStep]      = useState<WizardStep>('source')
  const [source,    setSource]    = useState<Source>('github')
  const [signingIn, setSigningIn] = useState(false)

  const [feedUrl,   setFeedUrl]   = useState('')
  const [feedName,  setFeedName]  = useState('')
  const [checking,  setChecking]  = useState(false)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [preview,   setPreview]   = useState<FeedPreview | null>(null)

  const [githubPhase, setGithubPhase] = useState<GithubPhase>({ kind: 'idle' })
  // Guards the check below against its own `setGithubPhase` calls: depending
  // on `githubPhase.kind` in the effect's deps would re-run it the moment
  // 'checking' commits, cancelling the very request it just started. A ref
  // sidesteps that because writing it doesn't schedule a re-render.
  const githubCheckStartedRef = useRef(false)

  // Read from the store rather than taken as a prop: the wizard is now reached
  // by URL, so there is no parent left to compute it.
  const offerTutorial = useStore(s => !s.vaults.some(v => v.kind === 'example'))
  const hasGithubVault = useStore(s => s.vaults.some(v => v.kind === 'github'))

  // Probed here rather than at module scope: the settings barrel is imported by
  // tests that never mount this screen, and a top-level `window` probe makes
  // merely importing the module a side effect.
  const available = isFolderPickerSupported() ? SOURCE_CARDS : SOURCE_CARDS.filter(c => c.id !== 'local')
  const sourceCards = offerTutorial ? [...available, TUTORIAL_CARD] : available

  const done = () => void navigate({ to: '/settings' })

  // Reused-sign-in check, run once per visit to the github step (reset
  // whenever the step is left — see setStep('source') below). A GitHub App
  // user-access-token grant authorizes the account, not one repository, so
  // an existing GitHub vault's tokens are equally good for adding a second —
  // this is what lets the step skip startGitHubSignIn's full-page redirect
  // (and the confusing instant bounce through github.com it does when the
  // browser is already signed in there) whenever one is usable. Whether
  // there's anything to check (`hasGithubVault`) is derived state, rendered
  // directly below rather than mirrored into `githubPhase` via a synchronous
  // setState here — only the async lookup itself belongs in the effect.
  useEffect(() => {
    if (step !== 'github' || !hasGithubVault) { githubCheckStartedRef.current = false; return }
    if (githubCheckStartedRef.current) return
    githubCheckStartedRef.current = true

    const githubVaultIds = useStore.getState().vaults.filter(v => v.kind === 'github').map(v => v.id)
    let cancelled = false
    setGithubPhase({ kind: 'checking' })
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
            setGithubPhase({ kind: 'repos-error', session, message: e instanceof Error ? e.message : 'Could not load repositories.' })
          }
        }
      })
      .catch(() => { if (!cancelled) setGithubPhase({ kind: 'signed-out' }) })
    return () => { cancelled = true }
  }, [step, hasGithubVault])

  async function handleSignIn() {
    setSigningIn(true)
    await startGitHubSignIn() // full-page redirect on success — component unmounts
    setSigningIn(false) // only reached if sign-in failed and notified instead of redirecting
  }

  async function handleConnectRepo(session: ReusableGitHubSession, repo: InstalledRepo) {
    setGithubPhase({ kind: 'connecting' })
    done()
    await addGitHubVaultOAuth({
      owner:        repo.owner,
      repo:         repo.repo,
      branch:       repo.branch,
      accessToken:  session.accessToken,
      refreshToken: session.refreshToken,
      expiresAt:    session.expiresAt,
    })
  }

  async function handleNext() {
    if (source === 'local') {
      done()
      await addLocalVault()
    } else if (source === 'example') {
      done()
      await addExampleVault()
    } else if (source === 'ical') {
      setStep('ical')
    } else {
      setStep('github')
    }
  }

  /**
   * Fetch the feed and show what it holds *before* the vault is created. A
   * mistyped secret address is otherwise indistinguishable from an empty
   * calendar, and the fix — remove the vault, re-add it — is far more work than
   * correcting the field here.
   */
  async function handleCheckFeed() {
    setChecking(true)
    setFeedError(null)
    setPreview(null)
    try {
      const result = await previewIcalFeed(feedUrl.trim())
      setPreview(result)
      // Seed the name from X-WR-CALNAME, but leave it editable: it is also what
      // the vault's id (and therefore its entry URLs) is derived from.
      setFeedName(current => current.trim().length > 0 ? current : result.name ?? 'Calendar')
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : 'Could not read that calendar.')
    } finally {
      setChecking(false)
    }
  }

  async function handleAddFeed() {
    done()
    await addIcalVault(feedUrl.trim(), feedName.trim() || 'Calendar')
  }

  if (step === 'source') {
    return (
      <div className="flex flex-col gap-5">
        <p className="px-1 text-xs text-muted-foreground">
          Pick where this vault&rsquo;s entries live. You can add more later.
        </p>

        <div className="flex flex-col gap-3">
          {sourceCards.map(({ id, Icon, title, desc }) => (
            <button
              key={id}
              type="button"
              aria-pressed={source === id}
              onClick={() => setSource(id)}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-4 text-left transition-colors',
                source === id
                  ? 'border-primary bg-primary/8'
                  : 'border-border hover:bg-accent',
              )}
            >
              <Icon className="mt-0.5 size-4.5 shrink-0 stroke-[1.7]" />
              <div>
                <div className="text-sm font-medium leading-snug">{title}</div>
                <div className="mt-1 text-xs leading-snug text-muted-foreground">{desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-end">
          <Button onClick={handleNext}>
            {source === 'local' ? 'Choose folder' : source === 'example' ? 'Add' : 'Next'}
          </Button>
        </div>
      </div>
    )
  }

  if (step === 'ical') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="px-1 text-sm font-semibold text-foreground">Subscribe to a calendar</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Calendar address</span>
          <Input
            value={feedUrl}
            onChange={e => { setFeedUrl(e.target.value); setPreview(null); setFeedError(null) }}
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          In Google Calendar this is <em>Settings → Integrate calendar → Secret address in iCal
          format</em>; in Outlook, <em>Publish a calendar → ICS</em>. Treat it like a password —
          anyone with the link can read the calendar.
        </p>
        <p className="text-xs text-muted-foreground">
          Meridian fetches the calendar through its own server, because calendar providers
          don&rsquo;t allow browsers to read these addresses directly. The address and its events
          pass through that server; nothing is stored there.
        </p>

        {feedError && <p className="text-xs text-destructive">{feedError}</p>}

        {preview && (
          <div className="rounded-lg border border-border p-3 text-xs">
            <p className="font-medium">{preview.name ?? 'Calendar'}</p>
            <p className="text-muted-foreground">
              {preview.eventCount} {preview.eventCount === 1 ? 'event' : 'events'} found
            </p>
          </div>
        )}

        {preview && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Name</span>
            <Input value={feedName} onChange={e => { setFeedName(e.target.value) }} />
          </label>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={() => { setStep('source') }} disabled={checking}>Back</Button>
          {preview
            ? <Button onClick={() => void handleAddFeed()}>Add calendar</Button>
            : (
              <Button onClick={() => void handleCheckFeed()} disabled={checking || feedUrl.trim().length === 0}>
                {checking ? 'Checking…' : 'Check calendar'}
              </Button>
            )}
        </div>
      </div>
    )
  }

  const backToSource = () => { setStep('source'); setGithubPhase({ kind: 'idle' }) }
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
      <div className="flex flex-col gap-4">
        <div className="px-1">
          <h2 className="text-sm font-semibold text-foreground">Connect a GitHub repository</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Signed in as <span className="font-medium text-foreground">{session.login}</span>.{' '}
            <button
              type="button"
              onClick={handleSignIn}
              disabled={signingIn}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Not you? Sign in with a different account
            </button>
          </p>
        </div>

        {githubPhase.kind === 'repos-error'
          ? <p className="text-xs text-destructive">{githubPhase.message}</p>
          : (
            <>
              {githubPhase.repos.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {githubPhase.repos.map(repo => (
                    <button
                      key={`${repo.owner}/${repo.repo}`}
                      type="button"
                      onClick={() => void handleConnectRepo(session, repo)}
                      className="rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                    >
                      {repo.owner}/{repo.repo}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Meridian isn&rsquo;t installed on any repository yet.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Only repositories with Meridian&rsquo;s GitHub App installed appear here.{' '}
                {installAppLink}
              </p>
            </>
          )}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={backToSource} disabled={signingIn}>Back</Button>
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
        <Button variant="ghost" onClick={backToSource} disabled={signingIn}>Back</Button>
      </div>
    </div>
  )
}
