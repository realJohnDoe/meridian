import { useState } from 'react'
import { Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TagChip } from '@/components'
import { CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'
import { cn } from '@/lib/cn'
import InlineCombobox, { comboboxInputClassName, comboboxListClassName } from './InlineCombobox'

const EMPTY_PARTICIPANTS: string[] = []

interface Props {
  participants:     string[]
  onChange:         (next: string[]) => void
  allParticipants?: string[]
}

export default function ParticipantsRow({ participants, onChange, allParticipants = EMPTY_PARTICIPANTS }: Props) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')

  const existing = new Set(participants.map(p => p.trim()))

  const q = query.trim().toLowerCase()
  const filtered = allParticipants.filter(p => !existing.has(p) && (!q || p.toLowerCase().includes(q)))

  const canAddNew = query.trim().length > 0 && !existing.has(query.trim())

  function close() {
    setOpen(false)
    setQuery('')
  }

  function add(name: string) {
    const trimmed = name.trim()
    if (!trimmed || existing.has(trimmed)) return
    onChange([...participants, trimmed])
    close()
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
      {open ? (
        <InlineCombobox
          open={open}
          onClose={close}
          shouldFilter={false}
          className={cn('w-40', comboboxInputClassName)}
        >
          {({ side, maxHeightPx, inputRef }) => (
            <>
              <CommandInput
                ref={inputRef}
                className="border-b-0"
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
              <CommandList
                className={comboboxListClassName(side, 'left-0 w-48')}
                style={{ maxHeight: maxHeightPx }}
              >
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
            </>
          )}
        </InlineCombobox>
      ) : (
        <Badge
          variant="tag"
          role="button"
          tabIndex={0}
          className="cursor-pointer text-primary bg-primary/12 gap-1"
          onClick={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true) }
          }}
        >
          <Plus size={9} />person
        </Badge>
      )}
    </div>
  )
}
