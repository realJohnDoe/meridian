import { Repeat2, Users } from 'lucide-react'
import type { Occurrence } from '../types'
import KindIcon from './KindIcon'
import { fmtT, parseDateString } from '../model/dateUtils'
import { fmtShort, buildTagTopicChips } from '../presentation'
import { Checkbox } from './ui/checkbox'
import { Badge } from './ui/badge'
import { Card } from './ui/card'
import { SurfaceButton } from './ui/surface-button'
import TagChip from './TagChip'
import { useStore } from '../store'
import { cn } from '../lib/utils'
import { occBarVariants, type OccState } from './ui/occurrence-variants'

export interface OccurrenceCardProps {
  occ: Occurrence
  variant?: 'agenda' | 'compact'
  isDone: boolean
  isPast?: boolean
  currentBarClass: OccState
  onOpen: () => void
  onToggleDone: () => void
  staticIcon?: boolean
  hideMeta?: boolean
  displayTitle?: string
  showDate?: boolean
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


/** Unified tag + topic chip row - reads roots map for wikilink resolution. */
function TagsRow({ tags, topics }: { tags: string[]; topics: string[] }) {
  const roots = useStore(s => s.roots)
  const chips = buildTagTopicChips(tags, topics, roots)
  if (!chips.length) return null
  return (
    <>
      {chips.map(c => <TagChip key={c.isTopic ? `topic:${c.raw}` : `tag:${c.raw}`} label={c.label} isTopic={c.isTopic} />)}
    </>
  )
}

export default function OccurrenceCard({
  occ,
  variant = 'agenda',
  isDone,
  isPast = false,
  currentBarClass,
  onOpen,
  onToggleDone,
  staticIcon = false,
  hideMeta = false,
  displayTitle,
  showDate = false,
}: OccurrenceCardProps) {
  const t = fmtT(occ.time)
  const hasTrack = occ.metadata.done !== undefined
  const tags = occ.metadata.tags || []
  const topics = (occ.metadata.topics as string[] | undefined) || []
  const participants = occ.metadata.participants || []
  const title = displayTitle ?? occ.metadata.title

  const dateBadge = (() => {
    const d = parseDateString(occ.date)
    return d ? fmtShort(d) : occ.date
  })()

  const dimmed = isDone || isPast
  const cardCls = [
    'relative transition-colors shadow-none',
    'bg-card border border-input rounded-lg',
    'hover:bg-accent',
    dimmed ? 'overflow-hidden' : '',
  ].filter(Boolean).join(' ')

  if (variant === 'agenda') {
    return (
      <Card
        data-tour="entry-card"
        className={`${cardCls} flex items-stretch gap-[9px] pl-[8px] pr-[14px] py-[8px]`}
        style={{ animation: 'fadeUp .16s ease both', animationDelay: 'var(--stagger, 0s)' }}
      >
        {dimmed && <div className="absolute inset-0 bg-black/40 pointer-events-none z-10 rounded-lg" />}

        {/* Full-bleed open button */}
        <SurfaceButton
          className="absolute inset-0 z-[1] rounded-lg"
          aria-label={title}
          onClick={onOpen}
        />

        {/* Priority bar */}
        <span className={cn(occBarVariants({ state: currentBarClass }), 'relative z-20')} />

        {/* Content - pointer-events-none passes clicks to the button behind */}
        <div className="relative z-20 flex flex-col flex-1 min-w-0 gap-1 py-[2px] pointer-events-none">
          <div className="flex items-center gap-[6px]">
            {hasTrack && (
              <Checkbox
                checked={isDone}
                onCheckedChange={() => onToggleDone()}
                className="size-5 shrink-0 pointer-events-auto"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
              />
            )}
            <span className={titleCls(isDone)}>{title}</span>

            {(!!occ.ownerId || !!t) && (
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

          {(showDate || tags.length > 0 || topics.length > 0 || participants.length > 0) && (
            <div className="flex flex-wrap gap-[5px]">
              {showDate && dateBadge && <Badge variant="tag">{dateBadge}</Badge>}
              <TagsRow tags={tags} topics={topics} />
              <ParticipantsBadge participants={participants} />
            </div>
          )}
        </div>
      </Card>
    )
  }

  // Compact variant
  return (
    <Card className={cardCls}>
      {dimmed && <div className="absolute inset-0 bg-black/40 pointer-events-none z-10 rounded-lg" />}

      {/* Full-bleed open button */}
      <SurfaceButton
        className="absolute inset-0 z-[1] rounded-lg"
        aria-label={title}
        onClick={onOpen}
      />

      <div className="relative z-20 flex items-start gap-2 pl-2.5 pr-3 py-2.5 pointer-events-none">
        <span className={occBarVariants({ state: currentBarClass })} />

        <div className="flex flex-col flex-1 min-w-0 gap-1">
          <div className="flex items-center gap-[6px]">
            {staticIcon
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
                : <KindIcon item={occ} size={13} className="shrink-0 text-muted-foreground" />}
            <span className={titleCls(isDone)}>{title}</span>
            {!!occ.ownerId && <Repeat2 size={11} className="stroke-muted-foreground fill-none shrink-0" />}
          </div>

          {!hideMeta && (dateBadge || t || tags.length > 0 || topics.length > 0 || participants.length > 0) && (
            <div className="flex flex-wrap gap-[5px]">
              {dateBadge && <Badge variant="tag">{dateBadge}</Badge>}
              {t && <Badge variant="tag">{t}</Badge>}
              <TagsRow tags={tags} topics={topics} />
              <ParticipantsBadge participants={participants} />
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
