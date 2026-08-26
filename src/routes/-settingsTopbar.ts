/**
 * What the app topbar shows while a settings screen is open.
 *
 * Settings lives inside the `_app` shell — it is a destination like Backlog
 * and Notes, not a surface floating over one — so the shell's single topbar
 * has to speak for it. Derived from the pathname here, as a pure function, so
 * the mapping is testable without mounting the router, and so the screens
 * themselves don't need a channel back up to the shell to name themselves.
 */
export interface SettingsTopbar {
  title: string
  /** Where the back control goes, or `null` on the settings root. */
  backTo: '/settings' | null
}

/**
 * @param pathname   the router's pathname (no base prefix)
 * @param vaultName  resolves a vault id to its display name, if it is loaded
 * @returns          `null` when `pathname` is not a settings screen
 */
export function settingsTopbar(
  pathname: string,
  vaultName: (vaultId: string) => string | undefined,
): SettingsTopbar | null {
  // Split rather than `startsWith('/settings')`, so a future `/settingsfoo`
  // route is not mistaken for a settings screen.
  const segments = pathname.split('/').filter(Boolean)
  if (segments[0] !== 'settings') return null

  const rest = segments.slice(1)
  if (rest.length === 0) return { title: 'Settings', backTo: null }

  if (rest[0] === 'appearance') return { title: 'Appearance', backTo: '/settings' }

  if (rest[0] === 'vault') {
    if (rest[1] === 'new') return { title: 'Add vault', backTo: '/settings' }
    // Falls back to a generic title while the vault registry is still
    // mounting; VaultDetail redirects out once it is loaded and still absent.
    if (rest[1]) return { title: vaultName(rest[1]) ?? 'Vault', backTo: '/settings' }
  }

  return { title: 'Settings', backTo: '/settings' }
}
