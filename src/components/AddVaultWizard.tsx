import { useState } from 'react'
import { HardDrive, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { addLocalVault, addGitHubVault, startGitHubSignIn } from '@/vaultActions'
import {
  ResponsiveModalTitle,
} from '@/components/ui/responsive-modal'

type WizardStep = 'source' | 'github'
type Source = 'local' | 'github'

const SOURCE_CARDS: { id: Source; Icon: typeof HardDrive; title: string; desc: string }[] = [
  {
    id:    'local',
    Icon:  HardDrive,
    title: 'Local folder',
    desc:  'Use a folder on this device. Works in Chrome and on Android; not supported on iOS or Safari.',
  },
  {
    id:    'github',
    Icon:  GitBranch,
    title: 'GitHub repository',
    desc:  'Sign in with GitHub, or connect manually with an access token. Works on any device and browser.',
  },
]

interface Props {
  onClose: () => void
  onBack:  () => void
}

export function AddVaultWizard({ onClose, onBack }: Props) {
  const [step,        setStep]        = useState<WizardStep>('source')
  const [source,      setSource]      = useState<Source>('local')
  const [showManual,  setShowManual]  = useState(false)
  const [repoStr,     setRepoStr]     = useState('')
  const [branch,      setBranch]      = useState('main')
  const [token,       setToken]       = useState('')
  const [busy,        setBusy]        = useState(false)
  const [signingIn,   setSigningIn]   = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  async function handleSignIn() {
    setSigningIn(true)
    await startGitHubSignIn() // full-page redirect — component unmounts
  }

  async function handleNext() {
    if (source === 'local') {
      onClose()
      await addLocalVault()
    } else {
      setStep('github')
    }
  }

  async function handleConnect() {
    setError(null)
    const parts = repoStr.trim().split('/')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError('Enter the repo as owner/repo (e.g. alice/notes).')
      return
    }
    if (!token.trim()) {
      setError('A GitHub token is required.')
      return
    }
    setBusy(true)
    try {
      await addGitHubVault({
        owner:  parts[0],
        repo:   parts[1],
        branch: branch.trim() || 'main',
        token:  token.trim(),
      })
      onClose()
    } catch (e) {
      setError((e as Error).message || 'Could not connect.')
      setBusy(false)
    }
  }

  if (step === 'source') {
    return (
      <>
        <ResponsiveModalTitle>Add vault</ResponsiveModalTitle>

        <div className="flex flex-col gap-3 p-4">
          {SOURCE_CARDS.map(({ id, Icon, title, desc }) => (
            <button
              key={id}
              onClick={() => setSource(id)}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
                source === id
                  ? 'border-primary bg-primary/8'
                  : 'border-border hover:bg-accent',
              )}
            >
              <Icon className="mt-0.5 size-4.5 shrink-0 stroke-[1.7]" />
              <div>
                <div className="text-sm font-medium leading-snug">{title}</div>
                <div className="mt-1 text-xs text-muted-foreground leading-snug">{desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-between px-4 pb-4">
          <Button variant="ghost" onClick={onBack}>Back</Button>
          <Button onClick={handleNext}>
            {source === 'local' ? 'Choose folder' : 'Next'}
          </Button>
        </div>
      </>
    )
  }

  return (
    <>
      <ResponsiveModalTitle>Connect GitHub repository</ResponsiveModalTitle>

      <div className="flex flex-col gap-3 p-4">
        <Button onClick={handleSignIn} disabled={signingIn}>
          {signingIn ? 'Redirecting to GitHub…' : 'Sign in with GitHub'}
        </Button>
        <p className="text-xs text-muted-foreground">
          Choose which repository to connect after signing in — no need to create a token by hand.
        </p>

        {!showManual && (
          <button
            onClick={() => setShowManual(true)}
            className="self-start text-xs text-muted-foreground underline"
          >
            Or connect manually with a personal access token
          </button>
        )}

        {showManual && (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              Create a{' '}
              <a
                href="https://github.com/settings/tokens?type=beta"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                fine-grained personal access token
              </a>{' '}
              on GitHub with these settings:
            </p>
            <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
              <li><strong>Repository access:</strong> Only select repositories — pick this vault&apos;s repo</li>
              <li><strong>Permissions → Contents:</strong> Read and write</li>
              <li>Leave all other permissions as <em>No access</em></li>
            </ul>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Repository</span>
              <input
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="owner/repo"
                value={repoStr}
                onChange={e => setRepoStr(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Branch</span>
              <input
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="main"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">Fine-grained access token</span>
              <input
                type="password"
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                placeholder="github_pat_…"
                value={token}
                onChange={e => setToken(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="flex justify-between px-4 pb-4">
        <Button variant="ghost" onClick={() => setStep('source')} disabled={busy || signingIn}>Back</Button>
        {showManual && (
          <Button onClick={handleConnect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect'}
          </Button>
        )}
      </div>
    </>
  )
}
