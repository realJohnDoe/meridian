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
import { occBarVariants } from './ui/occurrence-variants'
import TagChip from './TagChip'

export interface OccurrenceCardProps {
  occ: Occurrence
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

const titleCls = (isDone: boolean) =>
  `text-sm font-medium truncate ${isDone ? 'line-through' : ''} text-foreground`

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
              'size-[22px] rounded-full border-2 border-card bg-secondary',
              'flex items-center justify-center',
              'text-[8px] font-semibold text-secondary-foreground',
              i > 0 && '-ml-2'
            )}
          >
            {initials}
          </div>
        )
      })}
      {overflow > 0 && (
        <div className={cn(
          'size-[22px] rounded-full border-2 border-card bg-secondary -ml-2',
          'flex items-center justify-center',
          'text-[8px] font-semibold text-muted-foreground'
        )}>
          +{overflow}
        </div>
      )}
    </div>
  )
}


export default function OccurrenceCard({
  occ,
  onOpen,
  onToggleDone,
  leadingIcon,
  showTime = 'inline',
  showDate = false,
  showTagsParticipants = true,
  listedOn = [],
  animate = true,
}: OccurrenceCardProps) {
  const hour12   = useStore(s => s.localePrefs.hour12)
  const barClass = occState(occ)
  const isDone   = !!occ.metadata.done
  const isPast   = barClass === 'event-past'
  const title    = (occ.metadata.jsTime
    ? multidayDisplayTitle(occ, occ.metadata.jsTime)
    : undefined) ?? occ.metadata.title

  const t            = fmtT(occ.time, hour12)
  const hasTrack     = occ.metadata.done !== undefined
  const tags         = occ.metadata.tags || []
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
  const cardCls = [
    'relative transition-colors shadow-none',
    'bg-card border border-input rounded-lg',
    'hover:bg-accent',
    dimmed ? 'overflow-hidden' : '',
  ].filter(Boolean).join(' ')

  const hasDateTimeContent  = (showDate && !!dateBadge) || (showTime !== 'none' && !!t)
  const hasTagsContent      = showTagsParticipants && (tags.length > 0 || listedOn.length > 0)
  const showMeta            = hasDateTimeContent || hasTagsContent

  return (
    <Card
      data-tour="entry-card"
      className={`${cardCls} flex items-stretch gap-2 pl-2 pr-3.5 py-2 min-h-[44px]`}
      style={animate ? { animation: 'fadeUp .16s ease both', animationDelay: 'var(--stagger, 0s)' } : undefined}
    >
      {dimmed && <div className="absolute inset-0 pointer-events-none z-10 rounded-lg" style={{ background: 'var(--done-overlay)' }} />}

      <SurfaceButton
        className="absolute inset-0 z-[1] rounded-lg"
        aria-label={title}
        onClick={onOpen}
      />

      <span className={cn(occBarVariants({ state: barClass }), 'relative z-20')} />

      <div className={cn('relative z-20 flex flex-col flex-1 min-w-0 gap-1 py-0.5 pointer-events-none justify-center', dimmed && 'opacity-60')}>
        <div className="flex items-center gap-1.5">
          {/* Icon / checkbox */}
          {(() => {
            const showKind = leadingIcon === 'kind' || (leadingIcon === 'both' && !hasTrack)
            if (showKind) return <span className="shrink-0 w-5 flex items-center justify-center"><KindIcon item={occ} size={13} className="text-muted-foreground" /></span>
            if (hasTrack) return (
              <Checkbox
                checked={isDone}
                onCheckedChange={() => onToggleDone()}
                className="pointer-events-auto"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              />
            )
            return null
          })()}

          {/* Title + recurrence icon grouped so repeat stays left-adjacent to text */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className={titleCls(isDone)}>{title}</span>
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
            {showTime !== 'none' && t && durationLabel && <Badge variant="tag">{durationLabel}</Badge>}
            {showTagsParticipants && listedOn.map(label => (
              <TagChip key={label} label={label} isTopic />
            ))}
          </div>
        )}
      </div>

      {/* Participant avatar stack on the right */}
      {showTagsParticipants && (
        <div className="relative z-20 flex items-center pointer-events-none">
          <ParticipantAvatars participants={participants} />
        </div>
      )}
    </Card>
  )
}
