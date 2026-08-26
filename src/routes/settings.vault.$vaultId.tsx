import { createFileRoute } from '@tanstack/react-router'
import { VaultDetail } from '@/settings'

export const Route = createFileRoute('/settings/vault/$vaultId')({
  component: VaultDetailRoute,
})

function VaultDetailRoute() {
  const { vaultId } = Route.useParams()
  return <VaultDetail vaultId={vaultId} />
}
