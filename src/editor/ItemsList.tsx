import { useState, useCallback, useMemo } from 'react'
import { Plus, X, Tag, CircleFadingArrowUp } from 'lucide-react'
import type { Occurrence, Roots, StoreItem } from '../types'
import { parseItemEntry, serializeTaskEntry } from '../items'
import { fileEntries, fileOccurrenceMap } from '../presentation'
import { resolveWikilink } from '../wikilinks'
import OccurrenceCard from '@/components/OccurrenceCard'
import TagChip from '@/components/TagChip'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'

interface Props {
  items:           string[]
  onChange:        (items: string[]) => void
  roots:           Roots
  storeItems:      StoreItem[]
  onPromote:       (title: string, done: boolean) => string | null
  onOpenWikilink?: (ref: string) => void
  onToggleDone?:   (occ: Occurrence) => void
}

export default function ItemsList({ items, onChange, roots, storeItems, onPromote, onOpenWikilink, onToggleDone }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const [editingIdx,  setEditingIdx]  = useState<number | null>(null)
  const [editText,    setEditText]    = useState('')

  const occBySlug = useMemo(() => fileOccurrenceMap(storeItems, roots), [storeItems, roots])
  const allFiles  = useMemo(() => fileEntries(roots), [roots])
  const filtered  = pickerQuery
    ? allFiles.filter(e => e.title.toLowerCase().includes(pickerQuery.toLowerCase()))
    : allFiles

  const addTask = useCallback((text: string) => {
    const t = text.trim()
    if (!t) return
    onChange([...items, serializeTaskEntry(t, false)])
    setPickerQuery('')
    setPickerOpen(false)
  }, [items, onChange])

  const addLink = useCallback((fileSlug: string) => {
    const stored = `[[${fileSlug}]]`
    if (!items.includes(stored)) onChange([...items, stored])
    setPickerQuery('')
    setPickerOpen(false)
  }, [items, onChange])

  const remove = useCallback((idx: number) => {
    onChange(items.filter((_, i) => i !== idx))
  }, [items, onChange])

  const toggleTask = useCallback((idx: number, text: string, done: boolean) => {
    const next = [...items]
    next[idx] = serializeTaskEntry(text, !done)
    onChange(next)
  }, [items, onChange])

  function startEdit(idx: number, text: string) {
    setEditingIdx(idx)
    setEditText(text)
  }

  function commitEdit(idx: number, done: boolean) {
    const t = editText.trim()
    if (t) {
      const next = [...items]
      next[idx] = serializeTaskEntry(t, done)
      onChange(next)
    }
    setEditingIdx(null)
  }

  function promote(idx: number, text: string, done: boolean) {
    const slug = onPromote(text, done)
    if (!slug) return
    const next = [...items]
    next[idx] = `[[${slug}]]`
    onChange(next)
  }

  const entries = items.map((raw, idx) => ({ ...parseItemEntry(raw), idx }))

  return (
    <div className="mt-6 pt-5 border-t border-border">
      <div className="text-2xs font-semibold text-muted-foreground tracking-[.05em] uppercase mb-2.5">Items</div>
      <div className="flex flex-col gap-2">
        {entries.map(entry => {
          const { idx } = entry

          if (entry.kind === 'link') {
            const slug = resolveWikilink(entry.ref, roots)
            const occ  = slug ? occBySlug.get(slug) : undefined
            return (
              <div key={idx} className="flex items-start gap-1">
                <div className="flex-1 min-w-0">
                  {occ ? (
                    <OccurrenceCard
                      occ={occ}
                      eventNoteIcon
                      showTime="none"
                      showTagsParticipants={false}
                      onOpen={() => onOpenWikilink?.(occ.fileSlug)}
                      onToggleDone={() => onToggleDone?.(occ)}
                    />
                  ) : (
                    <TagChip label={entry.ref} isTopic className="opacity-50 line-through" />
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 mt-2 p-1 text-muted-foreground hover:text-foreground"
                  onClick={() => remove(idx)}
                  aria-label="Remove"
                >
                  <X size={13} />
                </button>
              </div>
            )
          }

          // task entry
          const { text, done } = entry
          const isEditing = editingIdx === idx
          return (
            <div key={idx} className="flex items-center gap-2 min-h-8">
              <Checkbox
                checked={done}
                onCheckedChange={() => isEditing ? undefined : toggleTask(idx, text, done)}
                className="size-4 shrink-0"
              />
              {isEditing ? (
                <input
                  autoFocus
                  className="flex-1 text-sm bg-transparent border-none outline-none"
                  value={editText}
                  onChange={e => setEditText(e.target.value)}
                  onBlur={() => commitEdit(idx, done)}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  { e.preventDefault(); commitEdit(idx, done) }
                    if (e.key === 'Escape') { setEditingIdx(null) }
                  }}
                />
              ) : (
                <span
                  className={`flex-1 text-sm cursor-pointer select-none ${done ? 'line-through text-muted-foreground' : ''}`}
                  onClick={() => startEdit(idx, text)}
                >
                  {text}
                </span>
              )}
              <button
                type="button"
                className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                onClick={() => promote(idx, text, done)}
                title="Convert to item"
              >
                <CircleFadingArrowUp size={13} />
              </button>
              <button
                type="button"
                className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
                onClick={() => remove(idx)}
                aria-label="Remove"
              >
                <X size={13} />
              </button>
            </div>
          )
        })}

        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <Badge
              variant="tag"
              className="cursor-pointer text-primary bg-primary/12 gap-1 w-fit mt-0.5"
              onClick={() => setPickerOpen(true)}
            >
              <Plus size={9} />add item
            </Badge>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Add item or link file…"
                value={pickerQuery}
                onValueChange={setPickerQuery}
                onKeyDown={e => {
                  if (e.key === 'Enter' && pickerQuery.trim() && filtered.length === 0) {
                    addTask(pickerQuery)
                  }
                }}
              />
              <CommandList>
                {pickerQuery.trim() && (
                  <CommandGroup heading="Item">
                    <CommandItem
                      value={`__task__${pickerQuery}`}
                      onSelect={() => addTask(pickerQuery)}
                    >
                      <Tag size={13} className="shrink-0 opacity-60" />
                      <span>Add <strong>"{pickerQuery.trim()}"</strong> as item</span>
                    </CommandItem>
                  </CommandGroup>
                )}
                {filtered.length > 0 && (
                  <CommandGroup heading="Link file">
                    {filtered.slice(0, 8).map(e => (
                      <CommandItem
                        key={e.fileSlug}
                        value={e.fileSlug}
                        onSelect={() => addLink(e.fileSlug)}
                      >
                        <span className="truncate">{e.title}</span>
                        {e.tags[0] && (
                          <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{e.tags[0]}</span>
                        )}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                {!pickerQuery && filtered.length === 0 && (
                  <CommandEmpty>No files found</CommandEmpty>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}
