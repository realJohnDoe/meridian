import { useMemo } from 'react'
import type { Roots } from '../types'
import { backlinksTo } from '../presentation'
import TagChip from '@/components/TagChip'

interface Props {
  fileSlug:        string | undefined
  roots:           Roots
  onOpenWikilink?: (ref: string) => void
}

export default function ListedOnRow({ fileSlug, roots, onOpenWikilink }: Props) {
  const slugs = useMemo(
    () => fileSlug ? backlinksTo(fileSlug, roots) : [],
    [fileSlug, roots],
  )
  if (!slugs.length) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-4 items-center">
      <span className="text-2xs text-muted-foreground font-medium tracking-[.05em] uppercase shrink-0">Listed on</span>
      {slugs.map(slug => {
        const label = roots.get(slug)?.title || slug
        return (
          <TagChip
            key={slug}
            label={label}
            isTopic
            interactive
            onNavigate={onOpenWikilink ? () => onOpenWikilink(slug) : undefined}
          />
        )
      })}
    </div>
  )
}
