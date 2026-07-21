import { useState } from 'react'
import { Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TagChip } from '@/components'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { FloatingComboboxList } from '@/components/ui/floating-combobox-list'
import { useFloatingCombobox } from '@/hooks'

const EMPTY_PARTICIPANTS: string[] = []

interface Props {
  participants:     string[]
  onChange:         (next: string[]) => void
  allParticipants?: string[]
}

export default function ParticipantsRow({ participants, onChange, allParticipants = EMPTY_PARTICIPANTS }: Props) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const { anchorRef, listRef, placement } = useFloatingCombobox(open, o => { setOpen(o); if (!o) setQuery('') })

  const existing = new Set(participants.map(p => p.trim()))

  const q = query.trim().toLowerCase()
  const filtered = allParticipants.filter(p => !existing.has(p) && (!q || p.toLowerCase().includes(q)))

  const canAddNew = query.trim().length > 0 && !existing.has(query.trim())

  function add(name: string) {
    const trimmed = name.trim()
    if (!trimmed || existing.has(trimmed)) return
    onChange([...participants, trimmed])
    setQuery('')
    setOpen(false)
  }

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <Users size={13} className="opacity-40 self-center" />
      {participants.map((p, i) => (
        <TagChip
          key={p}
          label={p.trim()}
          interactive
          onRemove={() => onChange(participants.filter((_, j) => j !== i))}
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
            <Badge
              variant="tag"
              className="cursor-pointer text-primary bg-primary/12 gap-1"
              onClick={() => setOpen(true)}
            >
              <Plus size={9} />person
            </Badge>
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
