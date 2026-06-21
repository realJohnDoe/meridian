import { Repeat2, Users } from 'lucide-react'
import type { Occurrence } from '../types'
import KindIcon from './KindIcon'
import { fmtT, parseDateString } from '../model/dateUtils'
import { fmtShort, occState } from '../presentation'
import { multidayDisplayTitle } from '../model/expansion'
import { Checkbox } from './ui/checkbox'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { SurfaceButton } from './ui/surface-button'
import { cn } from '../lib/utils'
import { occBarVariants } from './ui/occurrence-variants'
import TagChip from './TagChip'
import { getRoots } from '../storeBridge'

export interface OccurrenceCardProps {
  occ: Occurrence
  onOpen: () => void
  onToggleDone: () => void

  /** Trackable tasks show a checkbox (default: true). false → KindIcon instead. */
  taskCheckbox?: boolean
  /** Events and notes show their KindIcon (default: false). */
  eventNoteIcon?: boolean
  /**
   * Where to display the time:
   *   'inline' (default) — right-aligned cyan mono in the title row
   *   'badge'            — Badge in the meta row
   *   'none'             — not shown
   */
  showTime?: 'inline' | 'badge' | 'none'
  /** Show a date badge in the meta row (default: false). */
  showDate?: boolean
  /** Show tags, topics, and participants in the meta row (default: true). */
  showTagsParticipants?: boolean
}

const titleCls = (isDone: boolean) =>
  `text-[14px] font-medium truncate flex-1 ${isDone ? 'line-through' : ''} text-foreground`

function ParticipantsBadge({ participants }: { participants: string[] }) {
  if (!participants.length) return null
  const names = participants.slice(0, 2).join(', ')
  const overflow = participants.length > 2 ? ` +${participants.length - 2}` : ''
  return (
    <span className="inline-flex items-center gap-[3px] text-[11px] text-muted-foreground">
      <Users size={11} className="shrink-0" />
      {names}{overflow}
    </span>
  )
}


export default function OccurrenceCard({
  occ,
  onOpen,
  onToggleDone,
  taskCheckbox = true,
  eventNoteIcon = false,
  showTime = 'inline',
  showDate = false,
  showTagsParticipants = true,
}: OccurrenceCardProps) {
  const barClass = occState(occ)
  const isDone   = !!occ.metadata.done
  const isPast   = barClass === 'event-past'
  const title    = (occ.metadata.jsTime
    ? multidayDisplayTitle(occ, occ.metadata.jsTime)
    : undefined) ?? occ.metadata.title

  const t            = fmtT(occ.time)
  const hasTrack     = occ.metadata.done !== undefined
  const tags         = occ.metadata.tags || []
  const participants = occ.metadata.participants || []
  const roots      = getRoots()
  const listedOn   = Array.from(roots.entries())
    .filter(([, meta]) => meta.items.includes(`[[${occ.fileSlug}]]`))
    .map(([, meta]) => meta.title)

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

  const hasDateTimeContent  = (showDate && !!dateBadge) || (showTime === 'badge' && !!t)
  const hasTagsContent      = showTagsParticipants && (tags.length > 0 || participants.length > 0 || listedOn.length > 0)
  const showMeta            = hasDateTimeContent || hasTagsContent

  return (
    <Card
      data-tour="entry-card"
      className={`${cardCls} flex items-stretch gap-[9px] pl-[8px] pr-[14px] py-[8px]`}
      style={{ animation: 'fadeUp .16s ease both', animationDelay: 'var(--stagger, 0s)' }}
    >
      {dimmed && <div className="absolute inset-0 bg-black/40 pointer-events-none z-10 rounded-lg" />}

      <SurfaceButton
        className="absolute inset-0 z-[1] rounded-lg"
        aria-label={title}
        onClick={onOpen}
      />

      <span className={cn(occBarVariants({ state: barClass }), 'relative z-20')} />

      <div className="relative z-20 flex flex-col flex-1 min-w-0 gap-1 py-[2px] pointer-events-none">
        <div className="flex items-center gap-[6px]">
          {/* Icon / checkbox */}
          {!taskCheckbox
            ? <KindIcon item={occ} size={13} className="shrink-0 text-muted-foreground" />
            : hasTrack
              ? (
                <Checkbox
                  checked={isDone}
                  onCheckedChange={() => onToggleDone()}
                  className="size-5 shrink-0 pointer-events-auto"
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                />
              )
              : eventNoteIcon
                ? <KindIcon item={occ} size={13} className="shrink-0 text-muted-foreground" />
                : null}

          <span className={titleCls(isDone)}>{title}</span>

          {/* Repeat icon inline when time is not in the title row */}
          {showTime !== 'inline' && !!occ.ownerId && (
            <Repeat2 size={11} className="stroke-muted-foreground fill-none shrink-0" />
          )}

          {/* Right-aligned time column (inline mode) */}
          {showTime === 'inline' && (!!occ.ownerId || !!t) && (
            <div className="flex flex-col items-end shrink-0 ml-1 gap-px">
              <div className="flex items-end gap-[4px]">
                {!!occ.ownerId && <Repeat2 size={11} className="stroke-muted-foreground fill-none shrink-0" />}
                {!!t && <span className="text-[11px] font-mono text-brand-cyan tracking-[.02em] leading-[1.2]">{t}</span>}
              </div>
              {!!t && occ.metadata.duration && (
                <span className="text-[9px] font-mono text-dim leading-[1.2]">{occ.metadata.duration}</span>
              )}
            </div>
          )}
        </div>

        {/* Meta row */}
        {showMeta && (
          <div className="flex flex-wrap gap-[5px]">
            {showDate && dateBadge && <Badge variant="tag">{dateBadge}</Badge>}
            {showTime === 'badge' && t && <Badge variant="tag">{t}</Badge>}
            {showTagsParticipants && listedOn.map(label => (
              <TagChip key={label} label={label} isTopic />
            ))}
            {showTagsParticipants && (
              <ParticipantsBadge participants={participants} />
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
