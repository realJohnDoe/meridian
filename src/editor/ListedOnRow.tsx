import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Roots } from '../types'
import { backlinksTo, fileEntries } from '../presentation'
import { addItemLink } from './save'
import TagChip from '@/components/TagChip'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'

interface Props {
  fileSlug:        string | undefined
  roots:           Roots
  onOpenWikilink?: (ref: string) => void
}

export default function ListedOnRow({ fileSlug, roots, onOpenWikilink }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const slugs = useMemo(
    () => fileSlug ? backlinksTo(fileSlug, roots) : [],
    [fileSlug, roots],
  )

  const allFiles = useMemo(() => fileEntries(roots), [roots])
  const filtered = useMemo(() => {
    const alreadyLinked = new Set(slugs)
    return allFiles.filter(e =>
      e.fileSlug !== fileSlug &&
      !alreadyLinked.has(e.fileSlug) &&
      (!pickerQuery || e.title.toLowerCase().includes(pickerQuery.toLowerCase()))
    )
  }, [allFiles, fileSlug, slugs, pickerQuery])

  function handleSelect(targetSlug: string) {
    if (!fileSlug) return
    addItemLink(targetSlug, fileSlug)
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
          />
        )
      })}
      {fileSlug && (
        <Popover open={pickerOpen} onOpenChange={open => { setPickerOpen(open); if (!open) setPickerQuery('') }}>
          <PopoverTrigger asChild>
            <Badge
              variant="tag"
              className="cursor-pointer text-primary bg-primary/12 gap-1"
            >
              <Plus size={9} />add to list
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput
                placeholder="Search files…"
                value={pickerQuery}
                onValueChange={setPickerQuery}
              />
              <CommandList>
                <CommandEmpty>No files found</CommandEmpty>
                <CommandGroup>
                  {filtered.map(e => (
                    <CommandItem
                      key={e.fileSlug}
                      value={e.title}
                      onSelect={() => handleSelect(e.fileSlug)}
                    >
                      {e.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
