import { useMemo, useState } from 'react'
import { Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TagChip } from '@/components'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'

interface Props {
  participants:     string[]
  onChange:         (next: string[]) => void
  allParticipants?: string[]
}

export default function ParticipantsRow({ participants, onChange, allParticipants = [] }: Props) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')

  const existing = useMemo(() => new Set(participants.map(p => p.trim())), [participants])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return allParticipants.filter(p => !existing.has(p) && (!q || p.toLowerCase().includes(q)))
  }, [allParticipants, existing, query])

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
          key={i}
          label={p.trim()}
          interactive
          onRemove={() => onChange(participants.filter((_, j) => j !== i))}
        />
      ))}
      <Popover open={open} onOpenChange={o => { setOpen(o); if (!o) setQuery('') }}>
        <PopoverTrigger asChild>
          <Badge variant="tag" className="cursor-pointer text-primary bg-primary/12 gap-1">
            <Plus size={9} />person
          </Badge>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
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
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
