import { Repeat2, Users, CheckSquare, CalendarDays, FileText } from 'lucide-react'
import type { Occurrence } from '../types'
import { occKind } from '../types'
import { fmtT, parseDateString } from '../model/expansion'
import { fmtShort } from '../meridian'
import { Checkbox } from './ui/checkbox'
import { Badge } from './ui/badge'
import { Card } from './ui/card'

export interface OccurrenceCardProps {
  occ: Occurrence
  variant?: 'agenda' | 'compact'
  isDone: boolean
  currentBarClass: string
  onOpen: () => void
  onToggleDone: () => void
  showTypeIcon?: boolean
  displayTitle?: string
}

const titleCls = (isDone: boolean) =>
  `text-[14px] font-medium truncate flex-1 ${isDone ? 'line-through text-[var(--t3)]' : 'text-[var(--t0)]'}`

function ParticipantsBadge({ participants }: { participants: string[] }) {
  if (!participants.length) return null
  const names = participants.slice(0, 2).join(', ')
  const overflow = participants.length > 2 ? ` +${participants.length - 2}` : ''
  return (
    <span className="inline-flex items-center gap-[3px] text-[11px] text-[var(--t3)]">
      <Users size={11} className="shrink-0" />
      {names}{overflow}
    </span>
  )
}

function TypeIcon({ occ }: { occ: Occurrence }) {
  const kind = occKind(occ)
  if (kind === 'task') return <CheckSquare size={13} className="shrink-0 text-[var(--t3)]" />
  if (kind === 'event') return <CalendarDays size={13} className="shrink-0 text-[var(--t3)]" />
  return <FileText size={13} className="shrink-0 text-[var(--t3)]" />
}

export default function OccurrenceCard({
  occ,
  variant = 'agenda',
  isDone,
  currentBarClass,
  onOpen,
  onToggleDone,
  showTypeIcon = false,
  displayTitle,
}: OccurrenceCardProps) {
  const t = fmtT(occ.time)
  const hasTrack = occ.metadata.done !== undefined
  const tags = occ.metadata.tags || []
  const participants = occ.metadata.participants || []
  const title = displayTitle ?? occ.metadata.title

  const dateBadge = (() => {
    const d = parseDateString(occ.date)
    return d ? fmtShort(d) : occ.date
  })()

  const cardCls = [
    'cursor-pointer transition-colors shadow-none',
    'bg-[var(--bg2)] border border-[var(--bdr2)] rounded-[var(--r)]',
    'hover:bg-[var(--bg3)]',
    isDone ? 'opacity-50' : '',
  ].filter(Boolean).join(' ')

  const handleClick = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[role=checkbox]')) onOpen()
  }

  if (variant === 'agenda') {
    return (
      <Card
        className={`${cardCls} flex items-stretch gap-[9px] pl-[8px] pr-[14px] py-[8px] mx-2 mb-1.5`}
        style={{ animation: 'fadeUp .16s ease both', animationDelay: 'var(--stagger, 0s)' }}
        onClick={handleClick}
      >
        {/* Priority bar */}
        <span className={`occ-bar ${currentBarClass}`} />

        {/* Two rows stacked in a flex-col */}
        <div className="flex flex-col flex-1 min-w-0 gap-1 py-[2px]">
          {/* Row 1: checkbox + title + [recur icon + time/duration] on the right */}
          <div className="flex items-center gap-[6px]">
            {hasTrack && (
              <Checkbox
                checked={isDone}
                onCheckedChange={() => onToggleDone()}
                onClick={e => e.stopPropagation()}
                className="size-5 shrink-0"
              />
            )}
            <span className={titleCls(isDone)}>{title}</span>

            {/* Right-aligned: recur icon + time on one line, duration below */}
            {(!!occ.ownerId || !!t) && (
              <div className="flex flex-col items-end shrink-0 ml-1 gap-px">
                <div className="flex items-end gap-[4px]">
                  {!!occ.ownerId && <Repeat2 size={11} className="stroke-[var(--t3)] fill-none shrink-0" />}
                  {!!t && <span className="text-[11px] font-mono text-[var(--cyn)] tracking-[.02em] leading-[1.2]">{t}</span>}
                </div>
                {!!t && occ.metadata.duration && (
                  <span className="text-[9px] font-mono text-[var(--t2)] leading-[1.2]">{occ.metadata.duration}</span>
                )}
              </div>
            )}
          </div>

          {/* Row 2: tags + participants */}
          {(tags.length > 0 || participants.length > 0) && (
            <div className="flex flex-wrap gap-[5px]">
              {tags.map(tg => <Badge key={tg} variant="tag">{tg}</Badge>)}
              <ParticipantsBadge participants={participants} />
            </div>
          )}
        </div>
      </Card>
    )
  }

  // Compact variant
  return (
    <Card className={cardCls} onClick={handleClick}>
      <div className="flex items-start gap-2 pl-2.5 pr-3 py-2.5">
        <span className={`occ-bar ${currentBarClass}`} />

        {/* Two rows stacked in a flex-col */}
        <div className="flex flex-col flex-1 min-w-0 gap-1">
          {/* Row 1: [type icon] + checkbox + title */}
          <div className="flex items-center gap-[6px]">
            {showTypeIcon && !hasTrack && <TypeIcon occ={occ} />}
            {hasTrack && (
              <Checkbox
                checked={isDone}
                onCheckedChange={() => onToggleDone()}
                onClick={e => e.stopPropagation()}
                className="size-5 shrink-0"
              />
            )}
            <span className={titleCls(isDone)}>{title}</span>
            {!!occ.ownerId && <Repeat2 size={11} className="stroke-[var(--t3)] fill-none shrink-0" />}
          </div>

          {/* Row 2: date + time + tags + participants (omitted entirely when empty) */}
          {(dateBadge || t || tags.length > 0 || participants.length > 0) && (
            <div className="flex flex-wrap gap-[5px]">
              {dateBadge && <Badge variant="tag">{dateBadge}</Badge>}
              {t && <Badge variant="tag">{t}</Badge>}
              {tags.map(tg => <Badge key={tg} variant="tag">{tg}</Badge>)}
              <ParticipantsBadge participants={participants} />
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
