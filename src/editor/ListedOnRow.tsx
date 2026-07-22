import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Roots } from '@/types'
import { fileEntries } from '@/fileOccurrence'
import { TagChip } from '@/components'
import { Badge } from '@/components/ui/badge'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { FloatingComboboxList } from '@/components/ui/floating-combobox-list'
import { matchesQuery } from '@/lib/matching'
import { useFloatingCombobox } from '@/hooks'

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
  const { anchorRef, listRef, placement } = useFloatingCombobox(pickerOpen, open => { setPickerOpen(open); if (!open) setPickerQuery('') })

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
        <div ref={anchorRef} className="inline-block">
          <Command shouldFilter={false} className="contents">
            {pickerOpen ? (
              <div className="flex items-center rounded-md border border-input bg-background">
                <CommandInput
                  wrapperClassName="border-b-0"
                  placeholder="Search files…"
                  value={pickerQuery}
                  onValueChange={setPickerQuery}
                />
              </div>
            ) : (
              <Badge
                variant="tag"
                className="cursor-pointer text-primary bg-primary/12 gap-1"
                onClick={() => setPickerOpen(true)}
              >
                <Plus size={9} />add to list
              </Badge>
            )}
            <FloatingComboboxList placement={placement} listRef={listRef} className="w-64">
              <CommandList className="min-h-[12rem]">
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
            </FloatingComboboxList>
          </Command>
        </div>
      )}
    </div>
  )
}
