import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Roots } from '@/types'
import type { EntryKey } from '@/fileIO'
import { fileEntries } from '@/fileOccurrence'
import { AddChip, TagChip } from '@/components'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { FloatingComboboxList } from './FloatingComboboxList'
import { rankByQuery } from '@/lib/matching'
import { useFloatingCombobox } from '@/hooks'

interface Props {
  /** Entries whose `items:` list already points at this one. */
  linkedKeys:      EntryKey[]
  /** This entry, once it has an identity. Undefined for an untitled new draft. */
  entryKey:        EntryKey | undefined
  /** Which vault to offer candidates from — a wikilink never crosses a vault. */
  vaultId:         string | null
  roots:           Roots
  onOpenWikilink?: (ref: string) => void
  onAdd?:          (target: EntryKey) => void
  onRemove?:       (target: EntryKey) => void
  /**
   * Create a list by this name and add this entry to it. Omitted where there
   * is no vault to create a file in — the picker then just says no file
   * matched, as it always did.
   */
  onCreate?:       (title: string) => void
}

export default function ListedOnRow({ linkedKeys, entryKey, vaultId, roots, onOpenWikilink, onAdd, onRemove, onCreate }: Props) {
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')
  const { anchorRef, listRef, placement } = useFloatingCombobox(pickerOpen, open => { setPickerOpen(open); if (!open) setPickerQuery('') })

  const allFiles = fileEntries(roots, vaultId ?? undefined)
  const alreadyLinked = new Set(linkedKeys)
  const candidates = allFiles.filter(e => e.entryKey !== entryKey && !alreadyLinked.has(e.entryKey))
  const filtered = rankByQuery(pickerQuery, candidates, e => e.title)

  const newListTitle = pickerQuery.trim()
  // Nothing to offer creating when the vault already holds a file by that
  // name. Matched against every file, not just the candidates: one already
  // holding this entry is filtered out of the list, and offering to "create" it
  // again would put a second file by the same name in the vault.
  const canCreate = !!onCreate && !!newListTitle
    && !allFiles.some(e => e.title.toLowerCase() === newListTitle.toLowerCase())

  function closePicker() {
    setPickerQuery('')
    setPickerOpen(false)
  }

  function handleSelect(target: EntryKey) {
    if (!entryKey) return
    onAdd?.(target)
    closePicker()
  }

  function handleCreate() {
    if (!entryKey || !canCreate) return
    onCreate(newListTitle)
    closePicker()
  }

  if (!linkedKeys.length && !entryKey) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-4 items-center">
      <span className="text-2xs text-muted-foreground font-medium tracking-[.05em] uppercase shrink-0">Listed on</span>
      {linkedKeys.map(key => {
        const meta = roots.get(key)
        const label = meta?.title || meta?.fileSlug || key
        return (
          <TagChip
            key={key}
            label={label}
            isTopic
            interactive
            // The navigate callback takes a wikilink *ref* — a bare slug, what a
            // file would actually contain — not the store's key.
            onNavigate={onOpenWikilink && meta ? () => onOpenWikilink(meta.fileSlug) : undefined}
            onRemove={onRemove ? () => onRemove(key) : undefined}
          />
        )
      })}
      {entryKey && (
        <div ref={anchorRef} className="inline-block">
          <Command shouldFilter={false} className="contents">
            {pickerOpen ? (
              <div className="flex items-center rounded-md border border-input bg-background">
                <CommandInput
                  wrapperClassName="border-b-0"
                  placeholder="Search files…"
                  value={pickerQuery}
                  onValueChange={setPickerQuery}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && canCreate && filtered.length === 0) handleCreate()
                  }}
                />
              </div>
            ) : (
              <AddChip label="add to list" onClick={() => setPickerOpen(true)} />
            )}
            <FloatingComboboxList placement={placement} listRef={listRef} className="w-64">
              <CommandList>
                {canCreate && (
                  <CommandItem value={`__create__${newListTitle}`} onSelect={handleCreate}>
                    <Plus size={13} className="shrink-0 opacity-60" />
                    <span className="truncate">Create &quot;<strong>{newListTitle}</strong>&quot;</span>
                  </CommandItem>
                )}
                {!canCreate && <CommandEmpty>No files found</CommandEmpty>}
                <CommandGroup>
                  {filtered.slice(0, 8).map(e => (
                    <CommandItem
                      key={e.entryKey}
                      value={e.entryKey}
                      onSelect={() => handleSelect(e.entryKey)}
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
