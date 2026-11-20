import { useState } from 'react'
import { Plus, Tag, CircleCheck } from 'lucide-react'
import type { Roots } from '@/types'
import { fileEntries } from '@/fileOccurrence'
import { rankByQuery } from '@/lib/matching'
import { useFloatingCombobox } from '@/hooks'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { FloatingComboboxList } from './FloatingComboboxList'

interface Props {
  roots:        Roots
  vaultId:      string | null
  /** Bare slugs already linked from this entry — never offered again. */
  linkedSlugs:  Set<string>
  /** Done rows that can be reopened, keyed by the row's identity. */
  doneItems:    { key: string; label: string }[]
  onAddTask:    (text: string) => void
  onAddLink:    (fileSlug: string) => void
  onRedo:       (key: string) => void
}

/**
 * The "Add item…" affordance. Owns its open/query state so a keystroke
 * re-renders only this component, not the whole items section, and only builds
 * the vault-wide file list while open. Mutations that animate rows (`onRedo`)
 * call back into ItemsList, which owns the leaving-row state.
 */
export function ItemsPicker({ roots, vaultId, linkedSlugs, doneItems, onAddTask, onAddLink, onRedo }: Props) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const { anchorRef, listRef, placement } = useFloatingCombobox(open, setOpen)

  const allFiles = open ? fileEntries(roots, vaultId ?? undefined).filter(e => !linkedSlugs.has(e.fileSlug)) : []
  const filtered = query ? rankByQuery(query, allFiles, e => e.title) : allFiles
  const q = query.toLowerCase()
  const doneRows = doneItems.filter(d => !q || d.label.toLowerCase().includes(q))

  const done = (fn: () => void) => { fn(); setQuery(''); setOpen(false) }

  return (
    <div className="flex items-start gap-1">
      <div ref={anchorRef} className="flex-1">
        <Command shouldFilter={false} className="contents">
          {open ? (
            <div className="rounded-lg border border-input bg-background">
              <CommandInput
                wrapperClassName="border-b-0"
                placeholder="Add an item or link an entry…"
                value={query}
                onValueChange={setQuery}
                onKeyDown={e => {
                  if (e.key === 'Enter' && query.trim() && filtered.length === 0) {
                    done(() => onAddTask(query))
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-lg bg-state-subtle pl-2 pr-2.5 py-2 text-left text-primary-text shadow-none transition-colors hover-layer"
              onClick={() => setOpen(true)}
            >
              <Plus size={13} className="shrink-0" />
              <span className="text-sm">Add item…</span>
            </button>
          )}
          <FloatingComboboxList placement={placement} listRef={listRef} className="w-64">
            <CommandList>
              {query.trim() && (
                <CommandItem value={`__task__${query}`} onSelect={() => done(() => onAddTask(query))}>
                  <Tag size={13} className="shrink-0 opacity-60" />
                  <span>Add <strong>"{query.trim()}"</strong></span>
                </CommandItem>
              )}
              {doneRows.length > 0 && (
                <CommandGroup heading="Done items">
                  {doneRows.slice(0, 8).map(d => (
                    <CommandItem key={d.key} value={`__redo__${d.key}`} onSelect={() => done(() => onRedo(d.key))}>
                      <CircleCheck size={13} className="shrink-0 opacity-60" />
                      <span className="truncate">{d.label}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {filtered.length > 0 && (
                <CommandGroup heading="Link an entry">
                  {filtered.slice(0, 8).map(e => (
                    <CommandItem key={e.fileSlug} value={e.fileSlug} onSelect={() => done(() => onAddLink(e.fileSlug))}>
                      <span className="truncate">{e.title}</span>
                      {e.tags[0] && (
                        <span className="ml-auto text-2xs text-muted-foreground shrink-0">{e.tags[0]}</span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!query && filtered.length === 0 && doneRows.length === 0 && (
                <CommandEmpty>No files found</CommandEmpty>
              )}
            </CommandList>
          </FloatingComboboxList>
        </Command>
      </div>
      {/* Spacer matching the X button so the card aligns with cards above */}
      <span className="w-5 shrink-0" aria-hidden="true" />
    </div>
  )
}
