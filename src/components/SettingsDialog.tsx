import { useState } from 'react'
import { useTheme } from 'next-themes'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { useResetOnChange } from '@/hooks'
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from '@/components/ui/responsive-modal'
import { AddVaultWizard } from '@/components/AddVaultWizard'
import { VaultSettings } from '@/components/VaultSettings'

type Step = 'vault' | 'adding'

// Per-theme preview colors — same semantic slots in the same order for every theme.
// background: used as the button's own surface to give a sense of the theme's darkness.
// swatches: [primary, event, task, note, destructive] — the five most identity-defining tokens.
// Per-theme preview values — same semantic slots in the same order for every theme:
// background, foreground, then swatches: [primary, task, event, note, destructive].
const THEMES: { id: string; label: string; background: string; foreground: string; swatches: string[] }[] = [
  {
    id: 'meridian',
    label: 'Meridian',
    background: 'oklch(0.18 0.05 252)',
    foreground: 'oklch(0.96 0.02 270)',
    swatches: [
      'oklch(0.68 0.22 278)',  // primary
      'oklch(0.84 0.17 145)',  // task
      'oklch(0.71 0.20 278)',  // event
      'oklch(0.75 0.17 215)',  // note
      'oklch(0.72 0.20 15)',   // destructive
    ],
  },
  {
    id: 'tokyo-night',
    label: 'Tokyo Night',
    background: '#1a1b2e',
    foreground: '#c0caf5',
    swatches: [
      '#bb9af7',  // primary
      '#9ece6a',  // task
      '#bb9af7',  // event
      '#7dcfff',  // note
      '#f7768e',  // destructive
    ],
  },
  {
    id: 'dracula',
    label: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    swatches: [
      '#bd93f9',  // primary
      '#50fa7b',  // task
      '#bd93f9',  // event
      '#8be9fd',  // note
      '#ff5555',  // destructive
    ],
  },
  {
    id: 'tokyo-day',
    label: 'Tokyo Day',
    background: '#c9cbe0',
    foreground: '#3760bf',
    swatches: [
      '#7847bd',  // primary
      '#486e2a',  // task
      '#7847bd',  // event
      '#006b8f',  // note
      '#d4184b',  // destructive
    ],
  },
  {
    id: 'rose-pine-dawn',
    label: 'Rosé Pine Dawn',
    background: '#faf4ed',
    foreground: '#575279',
    swatches: [
      '#907aa9',  // primary (iris)
      '#6a8c3a',  // task (olive green)
      '#907aa9',  // event
      '#286983',  // note (pine)
      '#b4637a',  // destructive (love)
    ],
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    background: '#fdf6e3',
    foreground: '#586e75',
    swatches: [
      '#6c71c4',  // primary (violet)
      '#859900',  // task (green)
      '#6c71c4',  // event
      '#2aa198',  // note (cyan)
      '#dc322f',  // destructive (red)
    ],
  },
]

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const [step,            setStep]            = useState<Step>('vault')
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(null)

  const { theme, setTheme } = useTheme()
  const activeTheme         = theme ?? 'meridian'

  const vaults        = useStore(s => s.vaults)
  const activeVaultId = useStore(s => s.activeVaultId)

  function handleOpenChange(v: boolean) {
    if (v) {
      const id = activeVaultId ?? vaults[0]?.id ?? null
      setSelectedVaultId(id)
    } else {
      setStep('vault')
      setSelectedVaultId(null)
    }
    onOpenChange(v)
  }

  // If the selected vault was removed, fall back to active or first remaining vault
  useResetOnChange([vaults, open], () => {
    if (!open) return
    if (selectedVaultId && vaults.some(v => v.id === selectedVaultId)) return
    const id = activeVaultId ?? vaults[0]?.id ?? null
    setSelectedVaultId(id ?? null)
  })

  function handleVaultSelect(value: string) {
    if (value === '__add__') {
      setStep('adding')
    } else {
      setSelectedVaultId(value)
    }
  }

  const selectedVault = vaults.find(v => v.id === selectedVaultId)

  return (
    <ResponsiveModal open={open} onOpenChange={handleOpenChange}>
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalDescription>Settings</ResponsiveModalDescription>

        {step === 'vault' && (
          <>
            <ResponsiveModalTitle>Settings</ResponsiveModalTitle>

            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Appearance</span>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map(({ id, label, background, foreground, swatches }) => (
                    <button
                      key={id}
                      onClick={() => setTheme(id)}
                      className={cn(
                        'flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-left transition-colors',
                        activeTheme === id ? 'border-primary' : 'border-border hover:border-muted-foreground',
                      )}
                      style={{ background, color: foreground }}
                    >
                      {label}
                      <span className="flex gap-1">
                        {swatches.map(color => (
                          <span
                            key={color}
                            className="block size-2.5 rounded-full"
                            style={{ background: color }}
                          />
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <span className="text-sm font-medium pt-2 border-t border-border">Vaults</span>

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
                      <Plus className="size-3.5 stroke-[1.7]" />
                      Add new vault…
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>

              {selectedVault && (
                <VaultSettings
                  key={selectedVault.id}
                  vault={selectedVault}
                  isActive={selectedVault.id === activeVaultId}
                />
              )}
            </div>
          </>
        )}

        {step === 'adding' && (
          <AddVaultWizard
            onClose={() => { setStep('vault'); onOpenChange(false) }}
            onBack={() => setStep('vault')}
          />
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
