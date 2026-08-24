import { useState } from 'react'
import { useTheme } from 'next-themes'
import { ChevronDown, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { setDefaultVault } from '@/vaultActions'
import { useResetOnChange } from '@/hooks'
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Card } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
} from '@/components/primitives/responsive-modal'
import { AddVaultWizard } from '@/components/AddVaultWizard'
import { VaultSettings } from '@/components/VaultSettings'
import { VaultIcon } from '@/components/vaultIcon'

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
  /** Vault to select on open, overriding the default-vault fallback — set when
   *  Settings was opened via requestVaultSettings rather than the sidebar link. */
  initialVaultId?: string | null
}

export default function SettingsDialog({ open, onOpenChange, initialVaultId }: Props) {
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
  const offerTutorial  = !vaults.some(v => v.kind === 'example')

  const currentThemeLabel = THEMES.find(t => t.id === activeTheme)?.label ?? 'System'

  const [step,            setStep]            = useState<Step>('vault')
  // Collapsed by default: the theme grid is ten cards tall, and leaving it open
  // pushed everything below it — including the whole per-vault region — off the
  // first screen, which is what made the two regions impossible to perceive as
  // two regions. Appearance is also a set-once preference, so it is the right
  // thing to fold away behind the settings people actually come back to.
  const [themeOpen,       setThemeOpen]       = useState(false)
  // Lazy-initialized because this component mounts already `open` (gated behind
  // `hasOpenedSettings` in Sidebar), so there's no false->true transition for
  // `useResetOnChange` below to react to on the first render.
  const [selectedVaultId, setSelectedVaultId] = useState<string | null>(
    () => initialVaultId ?? defaultVaultId ?? vaults[0]?.id ?? null,
  )

  function handleOpenChange(v: boolean) {
    if (v) {
      const id = initialVaultId ?? defaultVaultId ?? vaults[0]?.id ?? null
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

            <div className="flex flex-col gap-5 p-4">
              {/* ── General ─────────────────────────────────────────────
                  Flat, uncontained content: these settings have no scope to
                  state, so the page level *is* their scope. The per-vault
                  region below is a card precisely because it does have one. */}
              <section className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-sm font-semibold text-foreground">General</h3>
                  <p className="text-xs text-muted-foreground">Applies to Meridian on this device.</p>
                </div>

                <Collapsible open={themeOpen} onOpenChange={setThemeOpen}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
                    <span className="text-xs font-medium text-foreground">Appearance</span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {currentThemeLabel}
                      <ChevronDown className={cn('size-3.5 transition-transform', themeOpen && 'rotate-180')} />
                    </span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      {THEMES.map(({ id, label, className }) => (
                        <button
                          key={id}
                          type="button"
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
                  </CollapsibleContent>
                </Collapsible>

                {writableVaults.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-foreground">New entries go to</span>
                      <Select
                        value={defaultVaultId ?? ''}
                        onValueChange={id => setDefaultVault(id)}
                      >
                        <SelectTrigger className="w-auto max-w-[55%]">
                          <SelectValue placeholder="Select vault…" />
                        </SelectTrigger>
                        <SelectContent>
                          {writableVaults.map(v => (
                            <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      The vault a new entry lands in unless you pick another one on the entry itself.
                    </p>
                  </div>
                )}
              </section>

              {/* ── Vaults ──────────────────────────────────────────────
                  A card, not a caption. The picker is the card's header, so
                  "which vault do these settings belong to?" is answered by
                  containment rather than by reading — and the two vault
                  dropdowns stop looking like the same control, because one is
                  now a row in a form and the other is the lid of a box. */}
              <section className="flex flex-col gap-3">
                <div className="flex flex-col gap-0.5">
                  <h3 className="text-sm font-semibold text-foreground">Vaults</h3>
                  <p className="text-xs text-muted-foreground">Settings for the selected vault only.</p>
                </div>

                <Card className="overflow-hidden">
                  <Select value={selectedVaultId ?? ''} onValueChange={handleVaultSelect}>
                    <SelectTrigger className="h-auto w-full rounded-none border-0 border-b border-border/60 bg-muted/40 px-4 py-3 text-sm text-foreground">
                      <SelectValue placeholder="Select vault…" />
                    </SelectTrigger>
                    <SelectContent>
                      {vaults.map(v => (
                        <SelectItem key={v.id} value={v.id}>
                          <span className="flex items-center gap-2">
                            <VaultIcon kind={v.kind} className="size-3.5 stroke-[1.7] shrink-0 text-muted-foreground" />
                            {v.name}
                          </span>
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
                    <div className="flex flex-col px-4">
                      <VaultSettings key={selectedVault.id} vault={selectedVault} />
                    </div>
                  )}
                </Card>
              </section>
            </div>
          </>
        )}

        {step === 'adding' && (
          <AddVaultWizard
            onClose={() => { setStep('vault'); onOpenChange(false) }}
            onBack={() => setStep('vault')}
            offerTutorial={offerTutorial}
          />
        )}
      </ResponsiveModalContent>
    </ResponsiveModal>
  )
}
