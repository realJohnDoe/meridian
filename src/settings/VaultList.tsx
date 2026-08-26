import { Plus } from 'lucide-react'
import { useStore } from '@/store'
import { VaultIcon } from '@/components'
import { SettingsSection, SettingsLinkRow } from './SettingsSection'
import { vaultSummary, attentionLabel } from './vaultSummary'

/**
 * Every registered vault, one row each, each row a link to its own screen.
 *
 * This replaces the dropdown that used to be the lid of the per-vault card.
 * A `Select` is the wrong control for a collection you navigate into: it hid
 * how many vaults existed and what state they were in, it read as a sibling of
 * the unrelated "new entries go to" picker directly above it, and — because it
 * portals above the sheet it lives in, as does anything opened inside that
 * sheet — it was what stacked Settings four layers deep.
 */
export default function VaultList() {
  const vaults         = useStore(s => s.vaults)
  const syncByVault    = useStore(s => s.syncByVault)
  const defaultVaultId = useStore(s => s.defaultVaultId)

  return (
    <SettingsSection
      title="Vaults"
      description="Where your entries live. Every vault stays mounted and syncing."
    >
      {vaults.map(vault => {
        const attention = syncByVault.get(vault.id)?.needsAttention ?? null
        return (
          <SettingsLinkRow
            key={vault.id}
            to="/settings/vault/$vaultId"
            params={{ vaultId: vault.id }}
            icon={<VaultIcon kind={vault.kind} className="size-4.5 shrink-0 stroke-[1.7] text-muted-foreground" />}
            label={vault.name}
            description={vaultSummary(vault)}
            badge={
              <>
                {vault.id === defaultVaultId && (
                  <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-2xs font-medium text-secondary-foreground">
                    Default
                  </span>
                )}
                {attention && (
                  <span className="shrink-0 rounded-full bg-note/15 px-1.5 py-0.5 text-2xs font-medium text-note">
                    {attentionLabel(attention.kind)}
                  </span>
                )}
              </>
            }
          />
        )
      })}

      <SettingsLinkRow
        to="/settings/vault/new"
        icon={<Plus className="size-4.5 shrink-0 stroke-[1.7] text-muted-foreground" />}
        label="Add vault"
        description="A GitHub repository, a local folder, or a calendar subscription."
      />
    </SettingsSection>
  )
}
