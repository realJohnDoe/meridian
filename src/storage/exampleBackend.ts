import type { StorageBackend, RawFile } from './backend'
import type { VaultKind } from '@/vaultRef'
import { generateBigVault } from './devFixtures/testVaultGen'
import { buildEntries } from './devFixtures/tutorialVault'

/**
 * Dev-only escape hatch for performance testing: serves a generated
 * large vault instead of the tutorial when `localStorage.meridian_bigvault`
 * is set to a file count. Gated on `import.meta.env.DEV` so the generator
 * (and this branch) are dead-code-eliminated from production builds.
 * See devFixtures/testVaultGen.ts for how to use it.
 */
function loadEntries(): Array<{ id: string; content: string }> {
  if (import.meta.env.DEV) {
    try {
      const n = Number(localStorage.getItem('meridian_bigvault'))
      if (n && n > 0) return generateBigVault(n)
    } catch { /* ignore */ }
  }
  return buildEntries()
}

const ENTRIES = loadEntries()

const VERSION = 'example-v4'

export class ExampleBackend implements StorageBackend {
  readonly id       = 'example'
  readonly name     = 'Tutorial'
  readonly kind: VaultKind = 'example'
  readonly readOnly = true
  /** Synthesized fresh on every load — no cache rows, nothing to poll. */
  readonly hasRemote = false

  async statAll(): Promise<Map<string, string>> {
    const m = new Map<string, string>()
    for (const e of ENTRIES) m.set(e.id + '.md', VERSION)
    return m
  }

  async readFiles(paths: string[]): Promise<RawFile[]> {
    const set = new Set(paths)
    return ENTRIES
      .filter(e => set.has(e.id + '.md'))
      .map(e => ({ path: e.id + '.md', content: e.content, version: VERSION }))
  }

  async readAll(): Promise<RawFile[]> {
    return ENTRIES.map(e => ({ path: e.id + '.md', content: e.content, version: VERSION }))
  }

  async write(_path: string, _content: string, _expectedVersion?: string): Promise<string | undefined> { return undefined }
  async delete(_path: string, _expectedVersion?: string): Promise<void> {}

  async ensurePermission(_interactive: boolean): Promise<PermissionState> {
    return 'granted'
  }
}
