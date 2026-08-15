import { useEffect } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useStore } from '@/store'
import { isEditScope } from '@/types'
import { EntrySkeleton } from '@/components/primitives/entry-skeleton'
import type { EditScope } from '@/types'

/**
 * Compatibility redirect for the pre-multi-vault URL `/entry/<slug>`.
 *
 * Entry URLs are now `/entry/<vault>/<slug>`, but a bare slug is exactly what
 * every bookmark, share link and browser-history entry made before this change
 * carries. Resolving it against the default vault is precise rather than a
 * guess: back when these links were minted there was only one vault, and the
 * default is what that vault became.
 *
 * The redirect waits for the vaults to be restored — `defaultVaultId` is
 * reconciled asynchronously, after the Dexie read — and replaces the history
 * entry rather than pushing, so Back still leaves the app instead of bouncing
 * through here.
 */
export const Route = createFileRoute('/_app/entry/$slug')({
  component: LegacyEntryRedirect,
  validateSearch: (s: Record<string, unknown>): { date?: string; scope?: EditScope } => ({
    date:  typeof s.date  === 'string' ? s.date  : undefined,
    scope: isEditScope(s.scope) ? s.scope : undefined,
  }),
})

function LegacyEntryRedirect() {
  const { slug }  = Route.useParams()
  const search    = Route.useSearch()
  const navigate  = useNavigate()
  const vaultId   = useStore(s => s.defaultVaultId)

  useEffect(() => {
    if (!vaultId) return
    void navigate({
      to: '/entry/$vault/$slug',
      params: { vault: vaultId, slug },
      search,
      replace: true,
    })
  }, [navigate, vaultId, slug, search])

  return <EntrySkeleton />
}
