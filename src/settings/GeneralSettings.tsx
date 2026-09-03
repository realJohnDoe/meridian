import { useTheme } from 'next-themes'
import { Palette } from 'lucide-react'
import { useStore } from '@/store'
import type { OccColorBy } from '@/occView'
import { setDefaultVault } from '@/vaultActions'
import { isWritableVault } from '@/vaultRef'
import { cn } from '@/lib/cn'
import { badgeVariants } from '@/components/ui/badge'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { SettingsSection, SettingsRow, SettingsLinkRow } from './SettingsSection'
import { themeLabel } from './themes'

/** The two occurrence color sources, in the order the toggle shows them. */
const COLOR_SOURCES: { value: OccColorBy; label: string }[] = [
  { value: 'type',  label: 'Type' },
  { value: 'vault', label: 'Vault' },
]

/** Intl `getWeekInfo` values, in the order the toggle shows them. */
const WEEK_STARTS: { value: 1 | 6 | 7; label: string }[] = [
  { value: 7, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 6, label: 'Saturday' },
]

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
  const localePrefs    = useStore(s => s.localePrefs)
  const setLocalePrefs = useStore(s => s.setLocalePrefs)
  const colorBy        = useStore(s => s.colorBy)
  const setColorBy     = useStore(s => s.setColorBy)

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

      <SettingsRow
        label="Week starts on"
        description="Used by the month and week views, and by the repeat picker."
      >
        <ToggleGroup
          type="single"
          value={String(localePrefs.firstDayOfWeek)}
          // A toggle group can be cleared by re-pressing the active item; the
          // empty string that produces is ignored, since "no first day of the
          // week" is not a state the calendar can render.
          onValueChange={v => { if (v) setLocalePrefs({ firstDayOfWeek: Number(v) as 1 | 6 | 7 }) }}
        >
          {WEEK_STARTS.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={String(value)}
              className={cn(badgeVariants({ variant: 'chip' }), 'flex-1 justify-center')}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsRow>

      <SettingsRow
        label="Color occurrences by"
        description="Type colors by event/task and priority. Vault colors by the vault an entry came from — vaults with no color set stay neutral, and tasks show a priority chip instead of a vault one."
      >
        <ToggleGroup
          type="single"
          value={colorBy}
          onValueChange={v => { if (v) setColorBy(v as OccColorBy) }}
        >
          {COLOR_SOURCES.map(({ value, label }) => (
            <ToggleGroupItem
              key={value}
              value={value}
              className={cn(badgeVariants({ variant: 'chip' }), 'flex-1 justify-center')}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsRow>

      <SettingsRow
        label="Time format"
        description="How times read on entries, the agenda and the day timeline."
      >
        <ToggleGroup
          type="single"
          value={localePrefs.hour12 ? '12' : '24'}
          onValueChange={v => { if (v) setLocalePrefs({ hour12: v === '12' }) }}
        >
          {[['12', '12-hour'], ['24', '24-hour']].map(([value, label]) => (
            <ToggleGroupItem
              key={value}
              value={value!}
              className={cn(badgeVariants({ variant: 'chip' }), 'flex-1 justify-center')}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsRow>
    </SettingsSection>
  )
}
