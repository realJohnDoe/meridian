import { useCallback, useMemo, useState } from 'react'
import type { Occurrence } from '../types'
import { titleToSlug } from '../fileIO'
import { addItemLink, removeItemLink } from './save'

export function usePendingLinks(item: Occurrence | null, title: string) {
  const [pendingSlugs, setPendingSlugs] = useState<string[]>([])

  const effectiveSlug = useMemo(
    () => item?.fileSlug ?? (title.trim() ? titleToSlug(title) : undefined),
    [item, title],
  )

  const handleAdd = useCallback((targetSlug: string) => {
    if (item) {
      addItemLink(targetSlug, item.fileSlug)
    } else {
      setPendingSlugs(prev => prev.includes(targetSlug) ? prev : [...prev, targetSlug])
    }
  }, [item])

  const handleRemove = useCallback((targetSlug: string) => {
    if (item) {
      removeItemLink(targetSlug, item.fileSlug)
    } else {
      setPendingSlugs(prev => prev.filter(s => s !== targetSlug))
    }
  }, [item])

  const flushOnSave = useCallback((finalSlug: string) => {
    if (item) return
    pendingSlugs.forEach(target => addItemLink(target, finalSlug))
  }, [item, pendingSlugs])

  return { effectiveSlug, pendingSlugs, handleAdd, handleRemove, flushOnSave }
}
