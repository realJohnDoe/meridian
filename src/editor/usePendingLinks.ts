import { useState } from 'react'
import type { Occurrence } from '../types'
import { titleToSlug, entryKey as makeEntryKey } from '../fileIO'
import type { EntryKey } from '../fileIO'
import { addItemLink, removeItemLink } from './save'

/**
 * `createdKey` is the key a brand-new entry's first save actually landed on —
 * prefer it over `titleToSlug(title)`, which is only an estimate: a title that
 * slugifies onto a slug another file already owns gets placed on a free one.
 *
 * `vaultId` is the vault the entry lives in (its own, or the target vault for a
 * brand-new one) — it is what turns that estimated slug into a real key.
 */
export function usePendingLinks(
  item: Occurrence | null,
  title: string,
  vaultId: string | null,
  createdKey?: EntryKey | null,
) {
  const [pendingKeys, setPendingKeys] = useState<EntryKey[]>([])

  const estimated = vaultId && title.trim() ? makeEntryKey(vaultId, titleToSlug(title)) : undefined
  const effectiveKey = item?.entryKey ?? createdKey ?? estimated
  // What gets written INTO the linked-to file: `[[bare-slug]]`, never the key.
  const sourceSlug = item?.metadata.fileSlug ?? (effectiveKey && titleToSlug(title))

  const handleAdd = (target: EntryKey) => {
    if (item) {
      addItemLink(target, item.metadata.fileSlug)
    } else {
      setPendingKeys(prev => prev.includes(target) ? prev : [...prev, target])
    }
  }

  const handleRemove = (target: EntryKey) => {
    if (item) {
      removeItemLink(target, item.metadata.fileSlug)
    } else {
      setPendingKeys(prev => prev.filter(k => k !== target))
    }
  }

  const flushOnSave = (finalSlug: string) => {
    if (item) return
    pendingKeys.forEach(target => addItemLink(target, finalSlug))
  }

  return { effectiveKey, sourceSlug, pendingKeys, handleAdd, handleRemove, flushOnSave }
}

// The subset consumed by EntryEditor; flushOnSave stays hook-internal (useEntryEditor
// triggers it directly from commitEntry, it's not part of the child's rendering needs).
export type PendingLinks = Pick<ReturnType<typeof usePendingLinks>, 'effectiveKey' | 'pendingKeys' | 'handleAdd' | 'handleRemove'>
