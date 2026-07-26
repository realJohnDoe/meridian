import { Users } from 'lucide-react'
import { useStore } from '@/store'
import { useAllParticipants } from '@/hooks'
import { NO_PARTICIPANT } from '@/calendar'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'

/**
 * The participant filter — a "who" filter over content, so it lives in the
 * topbar rather than the sidebar: it applies to every browsing view (agenda,
 * month, day, backlog, notes) and needs to stay visible on the screen it is
 * narrowing. The topbar hides it on entry routes, which is exactly right —
 * the filter stops at the document boundary.
 */
export default function ParticipantFilterButton() {
  const items                   = useStore(s => s.items)
  const participantFilter       = useStore(s => s.participantFilter)
  const toggleParticipantFilter = useStore(s => s.toggleParticipantFilter)
  const clearParticipantFilter  = useStore(s => s.clearParticipantFilter)

  const allParticipants = useAllParticipants(items)

  if (allParticipants.length === 0) return null

  const active = participantFilter.length > 0

  // One selection reads better as the name itself; beyond that the names
  // would ellipsize into uselessness, so fall back to a count.
  const label = !active
    ? null
    : participantFilter.length === 1
      ? (participantFilter[0] === NO_PARTICIPANT ? 'No participants' : participantFilter[0])
      : `${participantFilter.length} people`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size={active ? 'sm' : 'icon'}
          className={active
            ? 'rounded-full shrink-0 gap-1.5 max-w-40 text-accent-foreground bg-accent'
            : 'rounded-full shrink-0 text-dim'}
          aria-label={active ? `Filtered by ${label}. Change person filter` : 'Filter by person'}
        >
          <Users size={18} className="shrink-0" />
          {label && <span className="truncate text-sm">{label}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="end">
        <div className="flex items-center px-1 pb-1">
          <span className="flex-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">Filter by person</span>
          {active && (
            <button
              className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={clearParticipantFilter}
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-72 overflow-y-auto flex flex-col">
          <label className="flex items-center gap-2 cursor-pointer px-1 py-2">
            <Checkbox
              checked={participantFilter.includes(NO_PARTICIPANT)}
              onCheckedChange={() => toggleParticipantFilter(NO_PARTICIPANT)}
              visualClassName="size-4.5"
            />
            <span className="text-sm text-muted-foreground italic">No participants</span>
          </label>
          {allParticipants.map(p => (
            <label key={p} className="flex items-center gap-2 cursor-pointer px-1 py-2">
              <Checkbox
                checked={participantFilter.includes(p)}
                onCheckedChange={() => toggleParticipantFilter(p)}
                visualClassName="size-4.5"
              />
              <span className="text-sm truncate">{p}</span>
            </label>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
