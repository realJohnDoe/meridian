import { Navigate } from '@tanstack/react-router'
import { useStore } from '@/store'
import { PageSkeleton } from '@/components/primitives/page-skeleton'
import { VaultSettings } from './VaultSettings'

/**
 * Resolves `$vaultId` to a vault, or leaves the screen.
 *
 * Removal is handled by the redirect rather than by a callback on the remove
 * button: a vault can also disappear from under this screen because another
 * tab removed it, or because a restore dropped it, and all three cases want
 * the same thing. The redirect waits for `vaultLoading` so a cold navigation
 * straight to this URL doesn't bounce off an empty store before the registry
 * has mounted anything.
 */
export default function VaultDetail({ vaultId }: { vaultId: string }) {
  const vault        = useStore(s => s.vaults.find(v => v.id === vaultId))
  const vaultLoading = useStore(s => s.vaultLoading)

  if (vault) return <VaultSettings key={vault.id} vault={vault} />
  if (vaultLoading) return <PageSkeleton />
  return <Navigate to="/settings" replace />
}
