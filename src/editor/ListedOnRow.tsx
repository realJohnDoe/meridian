import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Roots } from '@/types'
import { fileEntries } from '@/fileOccurrence'
import { TagChip } from '@/components'
import { Badge } from '@/components/ui/badge'
import { CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { matchesQuery } from '@/lib/matching'
import { cn } from '@/lib/cn'
import InlineCombobox, { comboboxInputClassName, comboboxListClassName } from './InlineCombobox'

interface Props {
  slugs:           string[]
  fileSlug:        string | undefined
  roots:           Roots
  onOpenWikilink?: (ref: string) => void
  onAdd?:          (targetSlug: string) => void
  onRemove?:       (targetSlug: string) => void
}

export default function ListedOnRow({ slugs, fileSlug, roots, onOpenWikilink, onAdd, onRemove }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const allFiles = fileEntries(roots)
  const alreadyLinked = new Set(slugs)
  const filtered = allFiles.filter(e =>
    e.fileSlug !== fileSlug &&
    !alreadyLinked.has(e.fileSlug) &&
    matchesQuery(pickerQuery, e.title)
  )

  function handleSelect(targetSlug: string) {
    if (!fileSlug) return
    onAdd?.(targetSlug)
    setPickerQuery('')
    setPickerOpen(false)
  }

  if (!slugs.length && !fileSlug) return null

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
            onRemove={onRemove ? () => onRemove(slug) : undefined}
          />
        )
      })}
      {fileSlug && (
        pickerOpen ? (
          <InlineCombobox
            open={pickerOpen}
            onClose={() => { setPickerOpen(false); setPickerQuery('') }}
            shouldFilter={false}
            className={cn('w-40', comboboxInputClassName)}
          >
            {({ side, maxHeightPx, inputRef }) => (
              <>
                <CommandInput
                  ref={inputRef}
                  className="border-b-0"
                  placeholder="Search files…"
                  value={pickerQuery}
                  onValueChange={setPickerQuery}
                />
                <CommandList
                  className={comboboxListClassName(side, 'left-0 w-64')}
                  style={{ maxHeight: maxHeightPx }}
                >
                  <CommandEmpty>No files found</CommandEmpty>
                  <CommandGroup>
                    {filtered.slice(0, 8).map(e => (
                      <CommandItem
                        key={e.fileSlug}
                        value={e.fileSlug}
                        onSelect={() => handleSelect(e.fileSlug)}
                      >
                        {e.title}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </>
            )}
          </InlineCombobox>
        ) : (
          <Badge
            variant="tag"
            role="button"
            tabIndex={0}
            className="cursor-pointer text-primary bg-primary/12 gap-1"
            onClick={() => setPickerOpen(true)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setPickerOpen(true) }
            }}
          >
            <Plus size={9} />add to list
          </Badge>
        )
      )}
    </div>
  )
}
