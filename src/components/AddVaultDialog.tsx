import { useState } from 'react'
import { HardDrive, Github } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import { addLocalVault, addGitHubVault } from '../vault'

type Source = 'local' | 'github'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export default function AddVaultDialog({ open, onOpenChange }: Props) {
  const [step,    setStep]    = useState<'source' | 'github'>('source')
  const [source,  setSource]  = useState<Source>('local')
  const [token,   setToken]   = useState('')
  const [repoStr, setRepoStr] = useState('')
  const [branch,  setBranch]  = useState('main')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  function reset() {
    setStep('source')
    setSource('local')
    setToken('')
    setRepoStr('')
    setBranch('main')
    setBusy(false)
    setError(null)
  }

  function handleOpenChange(v: boolean) {
    if (!v) reset()
    onOpenChange(v)
  }

  async function handleNext() {
    if (source === 'local') {
      onOpenChange(false)
      reset()
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
      onOpenChange(false)
      reset()
    } catch (e) {
      setError((e as Error).message || 'Could not connect.')
      setBusy(false)
    }
  }

  const sourceCards: { id: Source; Icon: typeof HardDrive; title: string; desc: string }[] = [
    {
      id:    'local',
      Icon:  HardDrive,
      title: 'Local folder',
      desc:  'Use a folder on this device. Works in Chrome and on Android; not supported on iOS or Safari.',
    },
    {
      id:    'github',
      Icon:  Github,
      title: 'GitHub repository',
      desc:  'Use a GitHub repo as a vault via a fine-grained access token. Works on any device and browser.',
    },
  ]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        {step === 'source' ? (
          <>
            <DialogHeader>
              <DialogTitle>Add vault</DialogTitle>
              <DialogDescription>Choose where to store your notes.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2">
              {sourceCards.map(({ id, Icon, title, desc }) => (
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
                  <Icon className="mt-[2px] size-[18px] shrink-0 stroke-[1.7]" />
                  <div>
                    <div className="text-[14px] font-medium leading-snug">{title}</div>
                    <div className="mt-[3px] text-[12px] text-muted-foreground leading-snug">{desc}</div>
                  </div>
                </button>
              ))}
            </div>

            <div className="flex justify-end pt-1">
              <Button onClick={handleNext}>
                {source === 'local' ? 'Choose folder' : 'Next'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Connect GitHub repository</DialogTitle>
              <DialogDescription>
                Create a <strong>fine-grained personal access token</strong> scoped to a single
                repository with <em>Contents: read and write</em> permission. Store the token
                securely — it will be saved in your browser&apos;s local storage.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2">
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium">Repository</span>
                <input
                  className="search-bar-input w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
                  placeholder="owner/repo"
                  value={repoStr}
                  onChange={e => setRepoStr(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium">Branch</span>
                <input
                  className="search-bar-input w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
                  placeholder="main"
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium">Fine-grained access token</span>
                <input
                  type="password"
                  className="search-bar-input w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
                  placeholder="github_pat_…"
                  value={token}
                  onChange={e => setToken(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>

              {error && (
                <p className="text-[13px] text-destructive">{error}</p>
              )}
            </div>

            <div className="flex justify-between pt-1">
              <Button variant="ghost" onClick={() => setStep('source')} disabled={busy}>
                Back
              </Button>
              <Button onClick={handleConnect} disabled={busy}>
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
