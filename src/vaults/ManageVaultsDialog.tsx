import { useState } from 'react'
import { HardDrive, GitBranch, Trash2, Plus } from 'lucide-react'
import { vaultIcon } from '@/lib/vaultIcon'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { addLocalVault, addGitHubVault, removeVault } from '@/storage/vaultRegistry'

type Step = 'manage' | 'source' | 'github'
type Source = 'local' | 'github'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}


export default function ManageVaultsDialog({ open, onOpenChange }: Props) {
  const [step,    setStep]    = useState<Step>('manage')
  const [source,  setSource]  = useState<Source>('local')
  const [token,   setToken]   = useState('')
  const [repoStr, setRepoStr] = useState('')
  const [branch,  setBranch]  = useState('main')
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const vaults        = useStore(s => s.vaults)
  const activeVaultId = useStore(s => s.activeVaultId)

  function reset() {
    setStep('manage')
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

  async function handleRemove(id: string) {
    await removeVault(id)
    // If we removed the last non-example vault, stay open on manage view
    // (the vault list will just show Example only)
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
      Icon:  GitBranch,
      title: 'GitHub repository',
      desc:  'Use a GitHub repo as a vault via a fine-grained access token. Works on any device and browser.',
    },
  ]

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        {step === 'manage' && (
          <>
            <DialogHeader>
              <DialogTitle>Manage vaults</DialogTitle>
              <DialogDescription>Switch, add, or remove vaults.</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-1 py-2">
              {vaults.map(vault => {
                const VaultIcon  = vaultIcon(vault.kind)
                const isActive   = vault.id === activeVaultId
                const isExample  = vault.kind === 'example'
                return (
                  <div
                    key={vault.id}
                    className={cn(
                      'flex items-center gap-3 rounded-lg px-3 py-[10px]',
                      isActive && 'bg-primary/8',
                    )}
                  >
                    <VaultIcon className="size-[16px] shrink-0 stroke-[1.7] text-dim" />
                    <span className="flex-1 truncate text-[14px]">{vault.name}</span>
                    {isActive && (
                      <span className="text-[11px] font-medium text-primary px-2 py-[2px] rounded-full bg-primary/10 shrink-0">
                        Active
                      </span>
                    )}
                    {!isExample && (
                      <button
                        onClick={() => handleRemove(vault.id)}
                        title={`Remove "${vault.name}"`}
                        className="shrink-0 p-1 rounded text-dim hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="size-[14px] stroke-[1.7]" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex justify-end pt-1 border-t border-border">
              <Button variant="ghost" onClick={() => setStep('source')} className="gap-2">
                <Plus className="size-[15px] stroke-[1.7]" />
                Add vault
              </Button>
            </div>
          </>
        )}

        {step === 'source' && (
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

            <div className="flex justify-between pt-1">
              <Button variant="ghost" onClick={() => setStep('manage')}>Back</Button>
              <Button onClick={handleNext}>
                {source === 'local' ? 'Choose folder' : 'Next'}
              </Button>
            </div>
          </>
        )}

        {step === 'github' && (
          <>
            <DialogHeader>
              <DialogTitle>Connect GitHub repository</DialogTitle>
              <DialogDescription asChild>
                <div>
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
                  <ul className="mt-2 ml-4 list-disc space-y-1 text-[12px]">
                    <li><strong>Repository access:</strong> Only select repositories — pick this vault&apos;s repo</li>
                    <li><strong>Permissions → Contents:</strong> Read and write</li>
                    <li>Leave all other permissions as <em>No access</em></li>
                  </ul>
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3 py-2">
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium">Repository</span>
                <input
                  className="w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
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
                  className="w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
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
                  className="w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
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
              <Button variant="ghost" onClick={() => setStep('source')} disabled={busy}>Back</Button>
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
