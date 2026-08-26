/**
 * What the settings topbar shows for a given settings screen.
 *
 * The settings shell owns one topbar for four routes, so the title and the
 * back target are derived from the pathname here, as a pure function — the
 * mapping stays testable without mounting the router, and the screens don't
 * need a channel back up to the shell to name themselves.
 */
export interface SettingsTopbar {
  title: string
  /**
   * Where "up" goes: the settings list from any sub-screen, or `null` at the
   * root — which means there is no parent left *inside* Settings, so back
   * leaves it entirely. It never means "render no back button": the settings
   * shell has no sidebar docked beside it, so the back control is the only
   * way out at every depth.
   */
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
