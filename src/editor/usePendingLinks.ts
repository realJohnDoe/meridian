import { useState } from 'react'
import type { Occurrence } from '../types'
import { titleToSlug } from '../fileIO'
import { addItemLink, removeItemLink } from './save'

export function usePendingLinks(item: Occurrence | null, title: string) {
  const [pendingSlugs, setPendingSlugs] = useState<string[]>([])

  const effectiveSlug = item?.fileSlug ?? (title.trim() ? titleToSlug(title) : undefined)

  const handleAdd = (targetSlug: string) => {
    if (item) {
      addItemLink(targetSlug, item.fileSlug)
    } else {
      setPendingSlugs(prev => prev.includes(targetSlug) ? prev : [...prev, targetSlug])
    }
  }

  const handleRemove = (targetSlug: string) => {
    if (item) {
      removeItemLink(targetSlug, item.fileSlug)
    } else {
      setPendingSlugs(prev => prev.filter(s => s !== targetSlug))
    }
  }

  const flushOnSave = (finalSlug: string) => {
    if (item) return
    pendingSlugs.forEach(target => addItemLink(target, finalSlug))
  }

  return { effectiveSlug, pendingSlugs, handleAdd, handleRemove, flushOnSave }
}
