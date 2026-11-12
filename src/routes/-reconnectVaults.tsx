import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import {
  parseHandoff, isHandoffPresent, savePendingGitHub, addIcalVault, addLocalVault, startGitHubSignIn,
} from '@/storage'
import { Button } from '@/components/primitives/button'

/**
 * "Reconnect these vaults?" — the new origin's half of the hand-off that the
 * old origin's `MovedNotice` link starts. Reads the vault list from the URL
 * fragment, strips the fragment from the address bar straight away, and adds
 * nothing until the user confirms. A malformed fragment is ignored with a
 * quiet toast.
 */
export function ReconnectVaults() {
  const [offer, setOffer] = useState(() => parseHandoff(window.location.hash))
  const vaults = useStore(s => s.vaults)

  useEffect(() => {
    if (offer === undefined) return
    history.replaceState(null, '', window.location.pathname + window.location.search)
    if (offer === null) toast("Ignored a vault link that couldn't be read.")
  }, [offer])

  const todo = offer?.filter(v => !isHandoffPresent(v, vaults)) ?? []
  if (!offer || todo.length === 0) return null

  async function confirm() {
    setOffer(undefined)
    for (const v of todo) if (v.kind === 'ical') await addIcalVault(v.ical.url, v.name)
    if (todo.some(v => v.kind === 'github')) {
      savePendingGitHub(todo)
      await startGitHubSignIn()
    }
  }

  return (
    <div role="dialog" aria-label="Reconnect these vaults?" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg">
      <p className="font-medium">Reconnect these vaults?</p>
      <p className="mt-1 text-muted-foreground">From the old address. GitHub vaults need one sign-in; nothing secret was sent.</p>
      <ul className="mt-2 flex flex-col gap-1">
        {todo.map(v => (
          <li key={`${v.kind}:${v.name}`} className="flex items-center justify-between gap-2">
            <span className="truncate">{v.name}</span>
            {v.kind === 'local' && (
              <Button size="sm" variant="outline" onClick={() => void addLocalVault()}>Pick this folder again</Button>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => void confirm()}>Reconnect</Button>
        <Button size="sm" variant="outline" onClick={() => { setOffer(undefined) }}>Not now</Button>
      </div>
    </div>
  )
}
