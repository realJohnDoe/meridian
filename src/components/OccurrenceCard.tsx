import { Repeat2, Users } from 'lucide-react'
import type { Occurrence } from '../types'
import { fmtT } from '../model/expansion'
import { Checkbox } from './ui/checkbox'
import { Card } from './ui/card'
import TagChip from './TagChip'
import { unwrapRef, resolveWikilink } from '../wikilinks'
import { useStore } from '../store'

export interface OccurrenceCardProps {
  occ: Occurrence
  isDone: boolean
  currentBarClass: string
  onOpen: () => void
  onToggleDone: () => void
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

function TagsRow({ tags, topics }: { tags: string[]; topics: string[] }) {
  const items = useStore(s => s.items)

  // Build unified, alphabetically-sorted chip list
  type ChipItem = { label: string; isTopic: boolean; key: string }
  const tagChips: ChipItem[] = tags.map(t => ({ label: t, isTopic: false, key: `tag:${t}` }))
  const topicChips: ChipItem[] = topics.map(raw => {
    const ref = unwrapRef(raw)
    const resolved = resolveWikilink(ref, items)
    const label = resolved?.metadata.title || ref
    return { label, isTopic: true, key: `topic:${raw}` }
  })
  const all = [...tagChips, ...topicChips].sort((a, b) => a.label.localeCompare(b.label))
  if (!all.length) return null
  return (
    <div className="flex flex-wrap gap-[5px]">
      {all.map(c => <TagChip key={c.key} label={c.label} isTopic={c.isTopic} />)}
    </div>
  )
}

export default function OccurrenceCard({
  occ,
  isDone,
  currentBarClass,
  onOpen,
  onToggleDone,
}: OccurrenceCardProps) {
  const t = fmtT(occ.time)
  const hasTrack = occ.metadata.done !== undefined
  const tags = occ.metadata.tags || []
  const topics = (occ.metadata.topics as string[] | undefined) || []
  const participants = occ.metadata.participants || []

  const cardCls = [
    'cursor-pointer transition-colors shadow-none',
    'bg-[var(--bg2)] border border-[var(--bdr2)] rounded-[var(--r)]',
    'hover:bg-[var(--bg3)]',
    isDone ? 'opacity-50' : '',
  ].filter(Boolean).join(' ')

  const handleClick = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[role=checkbox]')) onOpen()
  }

  return (
    <Card
      className={`${cardCls} flex items-stretch gap-[9px] px-[14px] py-[8px] mx-2 mb-1.5`}
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
          <span className={titleCls(isDone)}>{occ.metadata.title}</span>

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

        {/* Row 2: tags + topics + participants */}
        {(tags.length > 0 || topics.length > 0 || participants.length > 0) && (
          <div className="flex flex-wrap gap-[5px]">
            <TagsRow tags={tags} topics={topics} />
            <ParticipantsBadge participants={participants} />
          </div>
        )}
      </div>
    </Card>
  )
}
