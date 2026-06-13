import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, Users } from 'lucide-react'
import type { EntryState } from './state'
import { Badge } from '@/components/ui/badge'

interface Props {
  participants: string[]
  onChange:     (updater: (prev: EntryState) => EntryState) => void
}

export default function ParticipantsRow({ participants, onChange }: Props) {
  const [inputVal,   setInputVal]   = useState('')
  const [showInput,  setShowInput]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  const commit = useCallback(() => {
    const p = inputVal.trim()
    if (p) onChange(prev => ({ ...prev, participants: [...prev.participants, p] }))
    setInputVal('')
    setShowInput(false)
  }, [inputVal, onChange])

  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      <Users size={13} className="opacity-40 self-center" />
      {participants.map((p, i) => (
        <Badge
          key={i}
          variant="tag"
          className="cursor-pointer"
          onClick={() => onChange(prev => ({ ...prev, participants: prev.participants.filter((_, j) => j !== i) }))}
        >
          {p}
        </Badge>
      ))}
      {showInput ? (
        <input
          ref={inputRef}
          className="bg-secondary border border-primary rounded-full px-2.5 py-0.5 text-[11px] text-foreground outline-none w-[90px] placeholder:text-muted-foreground"
          value={inputVal}
          placeholder="name"
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setInputVal(''); setShowInput(false) }
          }}
          onBlur={commit}
        />
      ) : (
        <Badge
          variant="tag"
          className="cursor-pointer text-primary bg-primary/12 gap-1"
          onClick={() => setShowInput(true)}
        >
          <Plus size={9} />person
        </Badge>
      )}
    </div>
  )
}
