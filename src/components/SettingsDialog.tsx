import { useState } from 'react'
import { useTheme } from 'next-themes'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { setDefaultVault } from '@/vaultActions'
import { useResetOnChange } from '@/hooks'
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from '@/components/primitives/responsive-modal'
import { AddVaultWizard } from '@/components/AddVaultWizard'
import { VaultSettings } from '@/components/VaultSettings'

type Step = 'vault' | 'adding'

// Preview buttons render with the theme's own CSS class so `bg-*`/`text-*`
// utilities resolve to that theme's actual tokens — no color values duplicated here.
// Meridian also needs its own class (not just relying on :root) because :root
// alone gets overridden globally whenever another theme is active on <html>.
// `System` leads, then our own pair, then the borrowed editor palettes
// alphabetically — so the two themes that are actually Meridian's are not
// buried mid-list between Dracula and Rosé Pine.
const THEMES: { id: string; label: string; className?: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'meridian', label: 'Meridian Dark', className: 'meridian' },
  { id: 'meridian-light', label: 'Meridian Light', className: 'meridian-light' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', className: 'catppuccin-latte' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', className: 'catppuccin-mocha' },
  { id: 'dracula', label: 'Dracula', className: 'dracula' },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', className: 'rose-pine-dawn' },
  { id: 'solarized-dark', label: 'Solarized Dark', className: 'solarized-dark' },
  { id: 'solarized-light', label: 'Solarized Light', className: 'solarized-light' },
  { id: 'tokyo-night', label: 'Tokyo Night', className: 'tokyo-night' },
]

// The five most identity-defining domain tokens, previewed as swatches.
const SWATCH_CLASSES = ['bg-event', 'bg-priority-1', 'bg-priority-3', 'bg-task', 'bg-note']

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

export default function SettingsDialog({ open, onOpenChange }: Props) {
  const { theme, setTheme, systemTheme } = useTheme()
  const activeTheme         = theme ?? 'system'
  // The System card has no class of its own, so it previews whichever of the
  // branded pair the OS currently resolves to — the swatches below render
  // from the card's own theme class, so without this it would inherit the
  // active theme's colors and misrepresent what picking it would do.
  const systemClass         = systemTheme === 'light' ? 'meridian-light' : 'meridian'

  const vaults         = useStore(s => s.vaults)
  const defaultVaultId = useStore(s => s.defaultVaultId)
  // Where new entries go. Every registered vault is mounted and syncing, so
  // this is purely a target choice — picking one loads nothing and unloads
  // nothing, which is the whole point of splitting `activeVaultId` apart.
  const writableVaults = vaults.filter(v => v.kind !== 'example')

  const [step,            setStep]            = useState<Step>('vault')
  // Lazy-initialized because this component mounts already `open` (gated behind
  // `hasOpenedSettings` in Sidebar), so there's no false->true transition for
  // `useResetOnChange` below to react to on the first render.
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(
    () => defaultVaultId ?? vaults[0]?.id ?? null,
  )

  function handleOpenChange(v: boolean) {
    if (v) {
      const id = defaultVaultId ?? vaults[0]?.id ?? null
      setSelectedVaultId(id)
    } else {
      setStep('vault')
      setSelectedVaultId(null)
    }
    onOpenChange(v)
  }

  // If the selected vault was removed, fall back to the default vault (only if
  // it still exists) or the first remaining vault. `defaultVaultId` is in the
  // deps so the fallback re-runs when it changes underneath us — e.g. while
  // removing a vault, `vaults` and `defaultVaultId` update in separate renders.
  useResetOnChange([vaults, defaultVaultId, open], () => {
    if (!open) return
    if (selectedVaultId && vaults.some(v => v.id === selectedVaultId)) return
    const fallback = vaults.find(v => v.id === defaultVaultId)?.id
    setSelectedVaultId(fallback ?? vaults[0]?.id ?? null)
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
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold">General</span>
                <p className="text-xs text-muted-foreground">Applies to Meridian on this device.</p>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium">Appearance</span>
                <div className="grid grid-cols-2 gap-2">
                  {THEMES.map(({ id, label, className }) => (
                    <button
                      key={id}
                      onClick={() => setTheme(id)}
                      className={cn(
                        'flex flex-col gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium text-left transition-colors bg-background text-foreground',
                        className ?? systemClass,
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

              {writableVaults.length > 0 && (
                <div className="flex flex-col gap-2 pt-2 border-t border-border">
                  <span className="text-sm font-medium">New entries go to</span>
                  <p className="text-xs text-muted-foreground">
                    The vault a new entry lands in unless you pick another one on the entry itself.
                  </p>
                  <Select
                    value={defaultVaultId ?? ''}
                    onValueChange={id => setDefaultVault(id)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select vault…" />
                    </SelectTrigger>
                    <SelectContent>
                      {writableVaults.map(v => (
                        <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-col gap-0.5 pt-3 border-t border-border">
                <span className="text-sm font-semibold">Vaults</span>
                <p className="text-xs text-muted-foreground">Settings for the selected vault only.</p>
              </div>

              <Select value={selectedVaultId ?? ''} onValueChange={handleVaultSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select vault…" />
                </SelectTrigger>
                <SelectContent>
                  {vaults.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
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
                <VaultSettings key={selectedVault.id} vault={selectedVault} />
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
