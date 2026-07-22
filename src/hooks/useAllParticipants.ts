import { useMemo } from 'react'
import type { StoreItem } from '@/types'

export function useAllParticipants(items: StoreItem[]) {
  return useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      for (const p of item.metadata.participants) {
        const trimmed = p.trim()
        if (trimmed) set.add(trimmed)
      }
    }
    return [...set].sort()
  }, [items])
}
