import { useState, useCallback } from 'react'
import { Plus, Tag } from 'lucide-react'
import type { Roots, StoreItem } from '../types'
import type { EntryState } from './state'
import { fileEntries, buildTagTopicChips } from '../presentation'
import { unwrapRef } from '../wikilinks'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from '@/components/ui/command'
import TagChip from '@/components/TagChip'
import KindIcon from '@/components/KindIcon'

interface Props {
  tags:           string[]
  topics:         string[]
  roots:          Roots
  items:          StoreItem[]
  onChange:       (updater: (prev: EntryState) => EntryState) => void
  onOpenWikilink: ((ref: string) => void) | undefined
}

export default function TagTopicRow({ tags, topics, roots, items, onChange, onOpenWikilink }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  const removeTag = useCallback((idx: number) => {
    onChange(prev => ({ ...prev, tags: prev.tags.filter((_, i) => i !== idx) }))
  }, [onChange])

  const removeTopic = useCallback((idx: number) => {
    onChange(prev => ({ ...prev, topics: prev.topics.filter((_, i) => i !== idx) }))
  }, [onChange])

  const addTag = useCallback((raw: string) => {
    const t = raw.trim()
    if (!t) return
    onChange(prev => prev.tags.includes(t) ? prev : { ...prev, tags: [...prev.tags, t] })
    setPickerQuery('')
    setPickerOpen(false)
  }, [onChange])

  const addTopic = useCallback((fileSlug: string) => {
    const stored = `[[${fileSlug}]]`
    onChange(prev => prev.topics.includes(stored) ? prev : { ...prev, topics: [...prev.topics, stored] })
    setPickerQuery('')
    setPickerOpen(false)
  }, [onChange])

  const chips = buildTagTopicChips(tags, topics, roots)

  const allFileEntries  = fileEntries(roots)
  const filteredEntries = pickerQuery
    ? allFileEntries.filter(e => e.title.toLowerCase().includes(pickerQuery.toLowerCase()))
    : allFileEntries

  function entryTypeIcon(fileSlug: string) {
    return <KindIcon item={items.find(i => i.fileSlug === fileSlug)} size={13} className="shrink-0 opacity-60" />
  }

  return (
    <div className="flex flex-wrap gap-1.5 mb-4 items-center">
      <Tag size={13} className="opacity-40 self-center shrink-0" />
      {chips.map(c => {
        if (c.isTopic) {
          const idx = topics.indexOf(c.raw)
          return (
            <TagChip
              key={c.raw}
              label={c.label}
              isTopic
              interactive
              onRemove={() => removeTopic(idx)}
              onNavigate={onOpenWikilink ? () => onOpenWikilink(unwrapRef(c.raw)) : undefined}
            />
          )
        }
        const idx = tags.indexOf(c.raw)
        return (
          <TagChip
            key={`tag:${idx}`}
            label={c.label}
            interactive
            onRemove={() => removeTag(idx)}
          />
        )
      })}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Badge
            variant="tag"
            className="cursor-pointer text-primary bg-primary/12 gap-1"
            onClick={() => setPickerOpen(true)}
          >
            <Plus size={9} />tag
          </Badge>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Tag or link file…"
              value={pickerQuery}
              onValueChange={setPickerQuery}
              onKeyDown={e => {
                if (e.key === 'Enter' && pickerQuery.trim() && filteredEntries.length === 0) {
                  addTag(pickerQuery)
                }
              }}
            />
            <CommandList>
              {pickerQuery.trim() && (
                <CommandGroup heading="Tag">
                  <CommandItem
                    value={`__tag__${pickerQuery}`}
                    onSelect={() => addTag(pickerQuery)}
                  >
                    <Tag size={13} className="shrink-0 opacity-60" />
                    <span>Add <strong>"{pickerQuery.trim()}"</strong> as tag</span>
                  </CommandItem>
                </CommandGroup>
              )}

              {filteredEntries.length > 0 && (
                <CommandGroup heading="Link file">
                  {filteredEntries.slice(0, 8).map(e => (
                    <CommandItem
                      key={e.fileSlug}
                      value={e.fileSlug}
                      onSelect={() => addTopic(e.fileSlug)}
                    >
                      {entryTypeIcon(e.fileSlug)}
                      <span className="truncate">{e.title}</span>
                      {e.tags[0] && (
                        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{e.tags[0]}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}

              {!pickerQuery && filteredEntries.length === 0 && (
                <CommandEmpty>No files found</CommandEmpty>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
