import { useMemo } from 'react'
import { keyVaultId } from '@/fileIO'
import type { StoreItem } from '@/types'

/** Participants are vault-specific: only items from `vaultId` contribute suggestions. */
export function useAllParticipants(items: StoreItem[], vaultId: string | null) {
  return useMemo(() => {
    if (!vaultId) return []
    const set = new Set<string>()
    for (const item of items) {
      if (keyVaultId(item.entryKey) !== vaultId) continue
      for (const p of item.metadata.participants) {
        const trimmed = p.trim()
        if (trimmed) set.add(trimmed)
      }
    }
    return [...set].sort()
  }, [items, vaultId])
}
