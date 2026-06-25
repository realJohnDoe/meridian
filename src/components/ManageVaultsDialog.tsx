import { useState, useEffect, useMemo } from 'react'
import { HardDrive, GitBranch, Trash2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { addLocalVault, addGitHubVault, removeVault, tokenSave, syncToBackend } from '@/storage'
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { ParticipantsRow } from '@/editor'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from '@/components/ui/responsive-modal'

type Step = 'vault' | 'source' | 'github'
type Source = 'local' | 'github'

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export default function ManageVaultsDialog({ open, onOpenChange }: Props) {
  const [step,               setStep]               = useState<Step>('vault')
  const [source,             setSource]             = useState<Source>('local')
  const [selectedVaultId,    setSelectedVaultId]    = useState<string | null>(null)
  const [vaultParticipants,  setVaultParticipants]  = useState<string[]>([])
  const [token,              setToken]              = useState('')
  const [repoStr,            setRepoStr]            = useState('')
  const [branch,             setBranch]             = useState('main')
  const [busy,               setBusy]               = useState(false)
  const [syncing,            setSyncing]            = useState(false)
  const [error,              setError]              = useState<string | null>(null)

  const vaults                 = useStore(s => s.vaults)
  const activeVaultId          = useStore(s => s.activeVaultId)
  const setDefaultParticipants = useStore(s => s.setDefaultParticipants)
  const items                  = useStore(s => s.items)

  const allParticipants = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      for (const p of item.metadata.participants) {
        const trimmed = p.trim()
        if (trimmed) set.add(trimmed)
      }
    }
    return [...set].sort()
  }, [items])

  function loadVaultLocals(vaultId: string) {
    try {
      const raw = localStorage.getItem(`meridian_default_participants_${vaultId}`)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      setVaultParticipants(Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [])
    } catch {
      setVaultParticipants([])
    }
    setSelectedVaultId(vaultId)
  }

  function handleOpenChange(v: boolean) {
    if (v) {
      const id = activeVaultId ?? vaults[0]?.id ?? null
      if (id) loadVaultLocals(id)
    } else {
      reset()
    }
    onOpenChange(v)
  }

  // If the selected vault was removed, fall back to active or first remaining vault
  useEffect(() => {
    if (!open) return
    if (selectedVaultId && vaults.some(v => v.id === selectedVaultId)) return
    const id = activeVaultId ?? vaults[0]?.id ?? null
    if (id) loadVaultLocals(id)
    else setSelectedVaultId(null)
  }, [vaults, open]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSyncNow() {
    setSyncing(true)
    try {
      await syncToBackend()
    } finally {
      setSyncing(false)
    }
  }

  function reset() {
    setStep('vault')
    setSource('local')
    setSelectedVaultId(null)
    setVaultParticipants([])
    setToken('')
    setRepoStr('')
    setBranch('main')
    setBusy(false)
    setSyncing(false)
    setError(null)
  }

  function handleVaultSelect(value: string) {
    if (value === '__add__') {
      setStep('source')
    } else {
      loadVaultLocals(value)
    }
  }

  function handleParticipantsChange(next: string[]) {
    setVaultParticipants(next)
    if (selectedVaultId) {
      localStorage.setItem(`meridian_default_participants_${selectedVaultId}`, JSON.stringify(next))
      if (selectedVaultId === activeVaultId) setDefaultParticipants(next)
    }
  }

  async function handleSaveToken() {
    if (!selectedVaultId || !token.trim()) return
    setBusy(true)
    setSyncing(true)
    setError(null)
    try {
      await tokenSave(selectedVaultId, token.trim())
      setToken('')
      await syncToBackend()
    } catch (e) {
      setError((e as Error).message || 'Could not save token.')
    } finally {
      setBusy(false)
      setSyncing(false)
    }
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
    // useEffect above handles falling back to a valid selectedVaultId
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

  const selectedVault = vaults.find(v => v.id === selectedVaultId)

  return (
    <ResponsiveModal open={open} onOpenChange={handleOpenChange}>
      <ResponsiveModalContent className="sm:max-w-[420px]">
        <ResponsiveModalDescription>Manage vaults</ResponsiveModalDescription>

        {step === 'vault' && (
          <>
            <ResponsiveModalTitle>Manage vaults</ResponsiveModalTitle>

            <div className="flex flex-col gap-4 p-4">
              <Select value={selectedVaultId ?? ''} onValueChange={handleVaultSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vault…" />
                </SelectTrigger>
                <SelectContent>
                  {vaults.map(v => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.name}{v.id === activeVaultId ? ' (active)' : ''}
                    </SelectItem>
                  ))}
                  <SelectSeparator />
                  <SelectItem value="__add__">
                    <span className="flex items-center gap-1.5">
                      <Plus className="size-[13px] stroke-[1.7]" />
                      Add new vault…
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              {selectedVault && (
                <>
                  {selectedVault.kind === 'local' && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[13px] font-medium">Folder</span>
                        <span className="text-[12px] text-muted-foreground font-mono truncate">{selectedVault.name}</span>
                      </div>
                      {selectedVaultId === activeVaultId && (
                        <Button variant="outline" size="sm" onClick={handleSyncNow} disabled={syncing} className="shrink-0">
                          {syncing ? 'Syncing…' : 'Sync now'}
                        </Button>
                      )}
                    </div>
                  )}

                  {selectedVault.kind === 'github' && (
                    <div className="flex flex-col gap-3 pt-2 border-t border-border">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-medium">Repository</span>
                        <span className="text-[12px] text-muted-foreground font-mono truncate">
                          {selectedVault.github.owner}/{selectedVault.github.repo} ({selectedVault.github.branch})
                        </span>
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className="text-[13px] font-medium">Update token</span>
                        <input
                          type="password"
                          className="w-full rounded border border-input bg-background px-3 py-2 text-[14px] outline-none focus:ring-1 focus:ring-ring"
                          placeholder="github_pat_… (leave blank to keep current)"
                          value={token}
                          onChange={e => { setToken(e.target.value); setError(null) }}
                          autoComplete="off"
                          spellCheck={false}
                        />
                      </label>
                      {error && <p className="text-[13px] text-destructive">{error}</p>}
                      <div className="flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={token.trim() ? handleSaveToken : handleSyncNow}
                          disabled={busy || syncing}
                        >
                          {(busy || syncing)
                            ? (token.trim() ? 'Saving…' : 'Syncing…')
                            : (token.trim() ? 'Save & sync' : 'Sync now')}
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-2 border-t border-border">
                    <span className="text-[13px] font-medium">Default participants</span>
                    <p className="text-[12px] text-muted-foreground">
                      Added to new entries in this vault automatically.
                    </p>
                    <ParticipantsRow
                      participants={vaultParticipants}
                      onChange={handleParticipantsChange}
                      allParticipants={allParticipants}
                    />
                  </div>

                  {selectedVault.kind !== 'example' && (
                    <div className="flex justify-end pt-2 border-t border-border">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1.5"
                        onClick={() => handleRemove(selectedVault.id)}
                      >
                        <Trash2 className="size-[13px] stroke-[1.7]" />
                        Remove vault
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {step === 'source' && (
          <>
            <ResponsiveModalTitle>Add vault</ResponsiveModalTitle>

            <div className="flex flex-col gap-3 p-4">
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

            <div className="flex justify-between px-4 pb-4">
              <Button variant="ghost" onClick={() => setStep('vault')}>Back</Button>
              <Button onClick={handleNext}>
                {source === 'local' ? 'Choose folder' : 'Next'}
              </Button>
            </div>
          </>
        )}

        {step === 'github' && (
          <>
            <ResponsiveModalTitle>Connect GitHub repository</ResponsiveModalTitle>

            <div className="flex flex-col gap-3 p-4">
              <p className="text-[13px] text-muted-foreground">
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
              <ul className="ml-4 list-disc space-y-1 text-[12px] text-muted-foreground">
                <li><strong>Repository access:</strong> Only select repositories — pick this vault&apos;s repo</li>
                <li><strong>Permissions → Contents:</strong> Read and write</li>
                <li>Leave all other permissions as <em>No access</em></li>
              </ul>

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

              {error && <p className="text-[13px] text-destructive">{error}</p>}
            </div>

            <div className="flex justify-between px-4 pb-4">
              <Button variant="ghost" onClick={() => setStep('source')} disabled={busy}>Back</Button>
              <Button onClick={handleConnect} disabled={busy}>
                {busy ? 'Connecting…' : 'Connect'}
              </Button>
            </div>
          </>
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
