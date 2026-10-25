import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AddChip, TagChip } from '@/components'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { FloatingComboboxList } from './FloatingComboboxList'
import { useFloatingCombobox } from '@/hooks'

const EMPTY_SUGGESTIONS: string[] = []

interface Props {
  values:       string[]
  onChange:     (next: string[]) => void
  /** Existing values to offer in the picker. */
  suggestions?: string[]
  /** What the add chip says it adds: "person", "tag". */
  noun:         string
  /** Leading icon; omitted when the row's label already says what it is. */
  icon?:        LucideIcon
}

/**
 * A removable-chip list with an add-by-picker-or-typing control. The shared body
 * of `ParticipantsRow` and `TagsRow`, which differ only in noun, icon and where
 * their suggestions come from.
 */
// `suggestions` takes its default via `??` in the body rather than as a
// destructured-parameter default — that shape makes
// babel-plugin-react-compiler silently skip memoizing this component. See
// OccurrenceCard.tsx for the full rationale.
export default function ChipListRow(props: Props) {
  const { values, onChange, noun, icon: Icon } = props
  const suggestions = props.suggestions ?? EMPTY_SUGGESTIONS
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const { anchorRef, listRef, placement } = useFloatingCombobox(open, o => { setOpen(o); if (!o) setQuery('') })

  const existing = new Set(values.map(v => v.trim()))

  const q = query.trim().toLowerCase()
  const filtered = suggestions.filter(p => !existing.has(p) && (!q || p.toLowerCase().includes(q)))

  const canAddNew = query.trim().length > 0 && !existing.has(query.trim())

  function add(name: string) {
    const trimmed = name.trim()
    if (!trimmed || existing.has(trimmed)) return
    onChange([...values, trimmed])
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {Icon && <Icon size={13} className="opacity-40 self-center" />}
      {values.map((p, i) => (
        <TagChip
          key={p}
          label={p.trim()}
          interactive
          onRemove={() => onChange(values.filter((_, j) => j !== i))}
        />
      ))}
      <div ref={anchorRef} className="inline-block">
        <Command shouldFilter={false} className="contents">
          {open ? (
            <div className="flex items-center rounded-md border border-input bg-background">
              <CommandInput
                wrapperClassName="border-b-0"
                placeholder="Name…"
                value={query}
                onValueChange={setQuery}
                onKeyDown={e => {
                  if (e.key === 'Enter' && canAddNew) {
                    e.preventDefault()
                    add(query)
                  }
                }}
              />
            </div>
          ) : (
            <AddChip label={noun} onClick={() => setOpen(true)} />
          )}
          <FloatingComboboxList placement={placement} listRef={listRef} className="w-48">
            <CommandList>
              <CommandEmpty>No suggestions</CommandEmpty>
              <CommandGroup>
                {canAddNew && (
                  <CommandItem value="__new__" onSelect={() => add(query)}>
                    Add "{query.trim()}"
                  </CommandItem>
                )}
                {filtered.map(p => (
                  <CommandItem key={p} value={p} onSelect={() => add(p)}>
                    {p}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </FloatingComboboxList>
        </Command>
      </div>
    </div>
  )
}
