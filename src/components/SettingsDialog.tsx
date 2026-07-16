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

// Preview buttons render with the theme's own CSS class so `bg-*`/`text-*`
// utilities resolve to that theme's actual tokens — no color values duplicated here.
// `className` is omitted for 'meridian' since it's the :root default.
const THEMES: { id: string; label: string; className?: string }[] = [
  { id: 'meridian', label: 'Meridian' },
  { id: 'tokyo-night', label: 'Tokyo Night', className: 'tokyo-night' },
  { id: 'dracula', label: 'Dracula', className: 'dracula' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', className: 'catppuccin-latte' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', className: 'rose-pine-dawn' },
  { id: 'solarized-light', label: 'Solarized Light', className: 'solarized-light' },
]

// The five most identity-defining domain tokens, previewed as swatches.
const SWATCH_CLASSES = ['bg-primary', 'bg-task', 'bg-event', 'bg-note', 'bg-destructive']

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

  // If the selected vault was removed, fall back to the active vault (only if it
  // still exists) or the first remaining vault. `activeVaultId` is in the deps so
  // the fallback re-runs when the active vault changes underneath us — e.g. while
  // removing a vault, `vaults` and `activeVaultId` update in separate renders.
  useResetOnChange([vaults, activeVaultId, open], () => {
    if (!open) return
    if (selectedVaultId && vaults.some(v => v.id === selectedVaultId)) return
    const active = vaults.find(v => v.id === activeVaultId)?.id
    setSelectedVaultId(active ?? vaults[0]?.id ?? null)
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
                  {THEMES.map(({ id, label, className }) => (
                    <button
                      key={id}
                      onClick={() => setTheme(id)}
                      className={cn(
                        'flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-left transition-colors bg-background text-foreground',
                        className,
                        activeTheme === id ? 'border-primary' : 'border-border hover:border-muted-foreground',
                      )}
                    >
                      {label}
                      <span className="flex gap-1">
                        {SWATCH_CLASSES.map(swatchClass => (
                          <span
                            key={swatchClass}
                            className={cn('block size-2.5 rounded-full', swatchClass)}
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
