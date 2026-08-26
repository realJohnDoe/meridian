import { useTheme } from 'next-themes'
import { Palette } from 'lucide-react'
import { useStore } from '@/store'
import { setDefaultVault } from '@/vaultActions'
import { isWritableVault } from '@/vaultRef'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { SettingsSection, SettingsRow, SettingsLinkRow } from './SettingsSection'
import { themeLabel } from './themes'

/**
 * Preferences that apply to Meridian as a whole on this device.
 *
 * Appearance is a link rather than an inline grid: ten theme cards are the
 * tallest thing in Settings by a wide margin, and inlining them is what
 * previously forced a collapsed-by-default `Collapsible` and pushed every
 * other setting off the first screen.
 */
export default function GeneralSettings() {
  const { theme } = useTheme()

  const vaults         = useStore(s => s.vaults)
  const defaultVaultId = useStore(s => s.defaultVaultId)

  // Where new entries go. Every registered vault is mounted and syncing, so
  // this is purely a target choice — picking one loads nothing and unloads
  // nothing, which is the whole point of splitting `activeVaultId` apart.
  // Gated on `isWritableVault`, not merely on "not the Tutorial vault": a
  // calendar subscription is read-only, so offering it here would name a
  // target that can never receive the entry.
  const writableVaults = vaults.filter(isWritableVault)

  return (
    <SettingsSection title="General" description="Applies to Meridian on this device.">
      <SettingsLinkRow
        to="/settings/appearance"
        icon={<Palette className="size-4.5 shrink-0 stroke-[1.7] text-muted-foreground" />}
        label="Appearance"
        value={themeLabel(theme)}
      />

      {writableVaults.length > 0 && (
        <SettingsRow
          label="New entries go to"
          description="The vault a new entry lands in unless you pick another one on the entry itself."
          control={
            <Select value={defaultVaultId ?? ''} onValueChange={id => setDefaultVault(id)}>
              <SelectTrigger className="w-auto min-w-36 max-w-56">
                <SelectValue placeholder="Select vault…" />
              </SelectTrigger>
              <SelectContent>
                {writableVaults.map(v => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      )}
    </SettingsSection>
  )
}
