import { useState } from 'react'
import { useStore } from '@/store'
import { Button } from '@/components/primitives/button'

const OLD_ORIGIN = 'https://realjohndoe.github.io'
const NEW_URL = 'https://meridian.realjohndoe.workers.dev/'

/**
 * Soft, dismissible "Meridian has moved" notice, shown only on the old
 * GitHub Pages origin. Credentials can't migrate across origins, so it says
 * what to redo there, and to sync first if a vault has unpushed changes.
 */
export function MovedNotice(props: { origin?: string }) {
  const [dismissed, setDismissed] = useState(false)
  const hasDirty = useStore(s => [...s.syncByVault.values()].some(v => v.dirtyCount > 0))
  const origin = props.origin ?? window.location.origin
  if (origin !== OLD_ORIGIN || dismissed) return null
  return (
    <div role="status" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
      <p className="font-medium">Meridian has moved</p>
      <p className="mt-1">
        Meridian now lives at <a className="underline" href={NEW_URL}>{NEW_URL}</a>. There, sign in
        again for GitHub vaults, pick the folder again for local-folder vaults, and re-install
        if you use it as an app. This copy keeps working.
      </p>
      {hasDirty && (
        <p className="mt-1 font-medium">Some vaults have changes that are not pushed yet. Sync first, then move.</p>
      )}
      <Button className="mt-2" variant="outline" size="sm" onClick={() => setDismissed(true)}>Dismiss</Button>
    </div>
  )
}
