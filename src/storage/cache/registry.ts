import { cacheInit } from './db'
import type { VaultRef } from '@/vaultRef'

// Which vaults exist and which one is active — the list vaultRegistry.ts
// restores on startup, kept in the `meta` table alongside the credentials.

export async function vaultRefsSave(refs: VaultRef[]): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: 'vaults', value: refs })
}

function isVaultRef(v: unknown): v is VaultRef {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  if (typeof r['id'] !== 'string' || typeof r['name'] !== 'string') return false
  // An iCal ref without its feed URL cannot build a backend, so it is rejected
  // here rather than mounted into a vault that can never load.
  if (r['kind'] === 'ical') {
    const ical = r['ical']
    return !!ical && typeof ical === 'object' && typeof (ical as Record<string, unknown>)['url'] === 'string'
  }
  return r['kind'] === 'local' || r['kind'] === 'example' || r['kind'] === 'github'
}

export async function vaultRefsLoad(): Promise<VaultRef[]> {
  const d = await cacheInit()
  const record = await d.meta.get('vaults')
  const v = record?.value
  return Array.isArray(v) ? v.filter(isVaultRef) : []
}

export async function activeVaultIdSave(id: string | null): Promise<void> {
  const d = await cacheInit()
  if (id === null) {
    await d.meta.delete('activeVaultId')
  } else {
    await d.meta.put({ key: 'activeVaultId', value: id })
  }
}

export async function activeVaultIdLoad(): Promise<string | null> {
  const d = await cacheInit()
  const record = await d.meta.get('activeVaultId')
  const v = record?.value
  return typeof v === 'string' ? v : null
}

/**
 * Whether the Tutorial vault has been removed — `null` when no decision has
 * ever been recorded (a fresh install, or one that predates this flag).
 */
export async function exampleVaultRemovedLoad(): Promise<boolean | null> {
  const d = await cacheInit()
  const record = await d.meta.get('exampleVaultRemoved')
  const v = record?.value
  return typeof v === 'boolean' ? v : null
}

export async function exampleVaultRemovedSave(removed: boolean): Promise<void> {
  const d = await cacheInit()
  await d.meta.put({ key: 'exampleVaultRemoved', value: removed })
}
