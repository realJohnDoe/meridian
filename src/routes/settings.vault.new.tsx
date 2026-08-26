import { createFileRoute } from '@tanstack/react-router'
import { AddVaultWizard } from '@/settings'

// Static, so it wins over `$vaultId` for the literal path `/settings/vault/new`
// — the same precedence `entry/new` relies on against `entry/$slug`.
export const Route = createFileRoute('/settings/vault/new')({
  component: AddVaultWizard,
})
