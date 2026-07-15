import { useState } from 'react'
import { Repeat2 } from 'lucide-react'
import type { Occurrence } from '@/types'
import KindIcon from './KindIcon'
import { fmtT, parseDateString, multidayDisplayTitle } from '@/model'
import { fmtShort } from '@/format'
import { useStore } from '@/store'
import { formatDurationChip, fmtDuration } from '@/format'
import { occState } from '@/occView'
import { Checkbox } from './ui/checkbox'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { SurfaceButton } from './ui/surface-button'
import { cn } from '@/lib/cn'
import { occVariants } from './ui/occurrence-variants'
import TagChip from './TagChip'

const EMPTY_LISTED_ON: string[] = []

interface OccurrenceCardProps {
  occ: Occurrence
  /** Current time for wall-clock-dependent styling (occState()). Defaults to `new Date()` if omitted. */
  now?: Date
  onOpen: () => void
  onToggleDone: () => void

  /**
   * What to render in the leading slot:
   *   'checkbox' — checkbox for trackable tasks, nothing otherwise
   *   'kind'     — always KindIcon
   *   'both'     — checkbox for trackable tasks, KindIcon otherwise
   */
  leadingIcon: 'checkbox' | 'kind' | 'both'
  /**
   * Where to display the time:
   *   'inline' (default) — chips in the title row
   *   'badge'            — chip in the meta row
   *   'none'             — not shown
   */
  showTime?: 'inline' | 'badge' | 'none'
  /** Show a date badge in the meta row (default: false). */
  showDate?: boolean
  /** Show tags, topics, and participants in the meta row (default: true). */
  showTagsParticipants?: boolean
  /** Titles of files that link to this entry (backlinks). Computed by the caller. */
  listedOn?: string[]
  /**
   * Set to false to suppress the fadeUp entrance animation. Use in virtualized
   * lists where remounting on scroll-in would replay the animation unexpectedly.
   * Defaults to true.
   */
  animate?: boolean
}

const titleCls = (struck: boolean) =>
  `text-sm font-medium truncate ${struck ? 'line-through' : ''}`

function ParticipantAvatars({ participants }: { participants: string[] }) {
  if (!participants.length) return null
  const shown = participants.slice(0, 3)
  const overflow = participants.length - shown.length
  return (
    <div className="flex items-center self-center shrink-0 pl-1">
      {shown.map((name, i) => {
        const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?'
        return (
          <div
            key={name}
            title={name}
            className={cn(
              'size-5.5 rounded-full border-2 border-card bg-secondary',
              'flex items-center justify-center',
              'text-3xs font-semibold text-secondary-foreground',
              i > 0 && '-ml-2'
            )}
          >
            {initials}
          </div>
        )
      })}
      {overflow > 0 && (
        <div className={cn(
          'size-5.5 rounded-full border-2 border-card bg-secondary -ml-2',
          'flex items-center justify-center',
          'text-3xs font-semibold text-muted-foreground'
        )}>
          +{overflow}
        </div>
      )}
    </div>
  )
}


export default function OccurrenceCard({
  occ,
  now,
  onOpen,
  onToggleDone,
  leadingIcon,
  showTime = 'inline',
  showDate = false,
  showTagsParticipants = true,
  listedOn = EMPTY_LISTED_ON,
  animate = true,
}: OccurrenceCardProps) {
  const hour12   = useStore(s => s.localePrefs.hour12)
  const barClass = occState(occ, now)
  const isPast   = barClass === 'event-past'

  // Optimistic local copy of `done` so the checkbox and its dependent styling
  // (strike-through, receded card surface) animate the instant the user clicks,
  // rather than waiting for the store commit — which, for after_completion repeats,
  // can be delayed several frames while the newly-generated next occurrence
  // settles into the virtualized list. Reconciled with the store value below
  // during render (the standard "adjusting state on prop change" pattern —
  // https://react.dev/learn/you-might-not-need-an-effect) once that commit
  // lands (a no-op in the common case where they already match).
  const storeDone = !!occ.metadata.done
  const [isDone, setIsDone] = useState(storeDone)
  const [prevStoreDone, setPrevStoreDone] = useState(storeDone)
  if (storeDone !== prevStoreDone) {
    setPrevStoreDone(storeDone)
    setIsDone(storeDone)
  }
  const title    = (occ.metadata.jsTime
    ? multidayDisplayTitle(occ, occ.metadata.jsTime)
    : undefined) ?? occ.metadata.title

  const t            = fmtT(occ.time, hour12)
  const hasTrack     = occ.metadata.done !== undefined
  const participants = occ.metadata.participants || []
  const rawDuration  = occ.metadata.duration
  const durationLabel = rawDuration
    ? (occ.time
        ? formatDurationChip(rawDuration, { date: occ.date, time: occ.time }, hour12)
        : fmtDuration(rawDuration))
    : null

  const dateBadge = (() => {
    const d = parseDateString(occ.date)
    return d ? fmtShort(d) : occ.date
  })()

  const dimmed  = isDone || isPast
  // `dimmed` (the optimistic local state) takes priority over `barClass` (the
  // store-derived state) so the card's tint/edge/text recede the instant the
  // user checks the box, not once the store commit lands (see the optimistic
  // `isDone` comment above) — the same trick occState already applies for
  // isPast, just generalized to the whole surface instead of only the bar.
  const cardCls = cn(
    'relative shadow-none rounded-lg',
    occVariants({ state: dimmed ? 'done' : barClass }),
    dimmed && 'overflow-hidden',
  )

  const hasDateTimeContent  = (showDate && !!dateBadge) || (showTime !== 'none' && (!!t || !!durationLabel))
  const hasTagsContent      = showTagsParticipants && listedOn.length > 0
  const showMeta            = hasDateTimeContent || hasTagsContent

  return (
    <Card
      data-tour="entry-card"
      className={`${cardCls} flex items-stretch gap-2 pl-3 pr-3.5 py-2 min-h-11`}
      style={animate ? { animation: 'fadeUp .16s ease both', animationDelay: 'var(--stagger, 0s)' } : undefined}
    >
      <SurfaceButton
        className="absolute inset-0 z-[1] rounded-lg"
        aria-label={title}
        onClick={onOpen}
      />

      <div className={cn('relative z-20 flex flex-col flex-1 min-w-0 gap-1 py-0.5 pointer-events-none justify-center', dimmed && 'opacity-60')}>
        <div className="flex items-center gap-1.5">
          {/* Icon / checkbox */}
          {(() => {
            const showKind = leadingIcon === 'kind' || (leadingIcon === 'both' && !hasTrack)
            if (showKind) return <span className="shrink-0 w-5 flex items-center justify-center"><KindIcon item={occ} size={13} className="text-muted-foreground" /></span>
            if (hasTrack) return (
              <Checkbox
                checked={isDone}
                onCheckedChange={() => {
                  setIsDone(d => !d)
                  onToggleDone()
                }}
                className="pointer-events-auto"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              />
            )
            return null
          })()}

          {/* Title + recurrence icon grouped so repeat stays left-adjacent to text */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={titleCls(dimmed)}>{title}</span>
            {!!occ.ownerId && (
              <Repeat2 size={11} className="stroke-muted-foreground fill-none shrink-0" />
            )}
          </div>
        </div>

        {/* Meta row */}
        {showMeta && (
          <div className="flex flex-wrap gap-1.5">
            {showDate && dateBadge && <Badge variant="tag">{dateBadge}</Badge>}
            {showTime !== 'none' && t && <Badge variant="tag">{t}</Badge>}
            {showTime !== 'none' && durationLabel && <Badge variant="tag">{durationLabel}</Badge>}
            {showTagsParticipants && listedOn.map(label => (
              <TagChip key={label} label={label} isTopic />
            ))}
          </div>
        )}
      </div>

      {/* Participant avatar stack on the right */}
      {showTagsParticipants && (
        <div className={cn('relative z-20 flex items-center pointer-events-none', dimmed && 'opacity-60')}>
          <ParticipantAvatars participants={participants} />
        </div>
      )}
    </Card>
  )
}
