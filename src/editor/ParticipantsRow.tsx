import { useEffect, useRef, useState } from 'react'
import { Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { TagChip } from '@/components'
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/ui/command'

const EMPTY_PARTICIPANTS: string[] = []

interface Props {
  participants:     string[]
  onChange:         (next: string[]) => void
  allParticipants?: string[]
}

export default function ParticipantsRow({ participants, onChange, allParticipants = EMPTY_PARTICIPANTS }: Props) {
  const [open,  setOpen]  = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Rendered inline (not in a Popover portal) so it stays part of the same
  // positioning context as its host — a Vaul bottom sheet in Settings would
  // otherwise reposition on input focus while a portaled popover fought it
  // for position independently. Without a portal we lose Radix's dismiss
  // handling, so replicate the two bits that matter: outside click and Escape.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  // Focus the input whenever the row opens so typing can start immediately —
  // the native `autoFocus` prop is avoided per jsx-a11y/no-autofocus.
  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  return (
    <div ref={containerRef} className="flex flex-col gap-1.5">
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
        <Badge
          variant="tag"
          className="cursor-pointer text-primary bg-primary/12 gap-1"
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Plus size={9} />person
        </Badge>
      </div>
      {open && (
        <div className="w-48 rounded-lg border border-input bg-popover shadow-lg overflow-hidden">
          <Command shouldFilter={false}>
            <CommandInput
              ref={inputRef}
              placeholder="Name…"
              value={query}
              onValueChange={setQuery}
              onKeyDown={e => {
                if (e.key === 'Enter' && canAddNew) {
                  e.preventDefault()
                  add(query)
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  close()
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
        </div>
      )}
    </div>
  )
}
