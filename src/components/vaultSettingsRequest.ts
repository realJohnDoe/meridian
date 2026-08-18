// Lets SyncButton's popover (topbar) open Settings (owned by Sidebar) scoped
// to one vault, without the two components sharing a common state owner —
// mirrors the module-scoped listener set storage/vaultRegistry.ts uses for
// onVaultChanged. Private to components/; nothing outside this subtree needs
// to open Settings for a specific vault.

type Listener = (vaultId: string) => void

const listeners = new Set<Listener>()

export function requestVaultSettings(vaultId: string): void {
  listeners.forEach(fn => fn(vaultId))
}

export function onVaultSettingsRequested(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
