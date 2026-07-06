import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { EditorView } from '@codemirror/view'
import { Calendar, Clock, Timer, Flag, Repeat, CheckSquare, CalendarDays, FileText } from 'lucide-react'
import type { Occurrence, StoreItem, Roots, EditScope } from '@/types'
import { isSeries } from '@/types'
import { badgeVariants } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import ListedOnRow from './ListedOnRow'
import ItemsList from './ItemsList'
import ParticipantsRow from './ParticipantsRow'
import EntryBody from './EntryBody'
import { cn } from '@/lib/cn'
import type { EntryState, ItemType } from './state'
import type { LucideIcon } from 'lucide-react'
import { saveNode } from './save'
import { formatDurationChip, fmtDuration, fmtShort } from '@/format'
import { fmtT, parseDateString } from '@/model'
import { useStore } from '@/store'
import { titleToSlug } from '@/fileIO'
import { backlinksTo } from '@/fileOccurrence'
import { usePendingLinks } from './usePendingLinks'

function PropChip({ icon: Icon, label, value, pressed, onClick, className }: {
  icon: LucideIcon
  label: string
  value?: string
  pressed: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button className={cn(badgeVariants({ variant: 'chip' }), className)} aria-pressed={pressed} onClick={onClick}>
      <Icon size={13} />{label}
      {value && <span className="text-[11px] font-mono opacity-80 ml-px">{value}</span>}
    </button>
  )
}


const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
const PRIORITY_CLASS: Record<string, string> = {
  high:   'aria-[pressed=true]:bg-p1/15 aria-[pressed=true]:border-p1 aria-[pressed=true]:text-p1',
  medium: 'aria-[pressed=true]:bg-p2/15 aria-[pressed=true]:border-p2 aria-[pressed=true]:text-p2',
  low:    'aria-[pressed=true]:bg-p3/15 aria-[pressed=true]:border-p3 aria-[pressed=true]:text-p3',
}
const TYPE_CHIP_ACTIVE_CLS: Record<string, string> = {
  task:  'data-[state=on]:text-task',
  event: 'data-[state=on]:text-event',
  note:  'data-[state=on]:text-note',
}


interface Props {
  entry: EntryState
  onChange: (updater: (prev: EntryState) => EntryState) => void
  onSave: (body: string) => void
  onAutoSave?: (body: string) => void
  onMetaSave?: (next: EntryState) => void
  getBodyRef?: React.MutableRefObject<() => string>
  flushPendingLinksRef?: React.MutableRefObject<() => void>
  onOpenDlg: (id: string) => void
  onOpenRepeatDlg: (itemType: ItemType) => void
  onScopeChange?: (scope: EditScope) => void
  onTypeChange?: (t: ItemType) => void
  onDoneToggle?: () => void
  items: StoreItem[]
  roots: Roots
  onOpenWikilink?: (ref: string) => void
  onToggleDoneBacklink?: (occ: Occurrence) => void
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

export default function EntryEditor({ entry, onChange, onSave, onAutoSave, onMetaSave, getBodyRef, flushPendingLinksRef, onOpenDlg, onOpenRepeatDlg, onScopeChange, onTypeChange, onDoneToggle, items, roots, onOpenWikilink, onToggleDoneBacklink }: Props) {
  const navigate           = useNavigate()
  const hour12             = useStore(s => s.localePrefs.hour12)
  const defaultParticipants = useStore(s => s.defaultParticipants)
  const titleRef  = useRef<HTMLTextAreaElement>(null)
  const viewRef   = useRef<EditorView | null>(null)

  // Updated every render so the caller's ref always calls with the current view
  useEffect(() => {
    if (getBodyRef) getBodyRef.current = () => viewRef.current?.state.doc.toString().trimEnd() ?? ''
  })

  useEffect(() => {
    if (titleRef.current) autoResize(titleRef.current)
  }, [entry.title])

  function handlePromoteTask(title: string, done: boolean): string | null {
    const result = saveNode(null, 'all', {
      item: null, title, tracked: true, itemType: 'task', done,
      body: '', tags: [], items: [], participants: [...defaultParticipants],
      priority: null, scheduled: null, duration: '', repeat: null,
      editScope: 'all',
    })
    if (result !== 'saved') return null
    const slug = titleToSlug(title)
    navigate({ to: '/entry/$slug', params: { slug } })
    return slug
  }

  function handleScopeChange(scope: EditScope) {
    onChange(prev => ({ ...prev, editScope: scope }))
    onScopeChange?.(scope)
  }

  const allParticipants = useMemo(() => {
    const set = new Set<string>()
    for (const storeItem of items) {
      for (const p of storeItem.metadata.participants) {
        const trimmed = p.trim()
        if (trimmed) set.add(trimmed)
      }
    }
    return [...set].sort()
  }, [items])

  const { item, title, body, scheduled, duration, tracked, itemType, repeat, done, items: listItems, participants, priority, editScope } = entry

  const { effectiveSlug, pendingSlugs, handleAdd, handleRemove, flushOnSave } = usePendingLinks(item, title)

  // Updated every render so commitEntry can flush pending "listed on" links once
  // a brand-new item is actually created (first autosave), using its final slug.
  useEffect(() => {
    if (flushPendingLinksRef) flushPendingLinksRef.current = () => flushOnSave(titleToSlug(title))
  })

  const linkedSlugs = useMemo(
    () => [...backlinksTo(effectiveSlug ?? '', roots), ...pendingSlugs],
    [effectiveSlug, roots, pendingSlugs],
  )

  const parentSeries = item?.ownerId ? items.find(i => isSeries(i) && i.id === item.ownerId) : null
  const isRecur = !!(item && item.ownerId)
  const seriesRepeat = (parentSeries && isSeries(parentSeries)) ? parentSeries.repeat : null
  const isScheduled = !!(item && seriesRepeat?.type === 'schedule')
  const isAfterCompletion = !!(item && seriesRepeat?.type === 'after_completion')
  const hasSched = !!(item && item.date)

  const hasDate = !!scheduled
  const hasTime = !!(scheduled?.time)
  const isSingleScope = editScope === 'single'
  const isNote = itemType === 'note'

  const showDateChip = !isNote
  const showRepeat = !isNote && (hasDate || tracked) && (!isSingleScope || !isRecur)
  const bodyKey = item ? `${item.fileSlug || 'item'}-${item.date || ''}-${editScope}` : 'new'

  const showScopeRow = isRecur || hasSched

  return (
    <>
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]"><div className="px-3.5 pt-4.5 pb-30 lg:max-w-[720px] lg:mx-auto">

        {/* ── FILE-LEVEL: title + slug ── */}
        <div className="flex items-start gap-2.5 mb-3">
          {tracked && (
            <Checkbox
              checked={done}
              onCheckedChange={() => onDoneToggle?.()}
              className="mt-1"
              visualClassName="size-6"
            />
          )}
          <div className="flex-1 min-w-0">
            <textarea
              ref={titleRef}
              className="w-full text-2xl font-light text-foreground bg-transparent border-none outline-none leading-snug resize-none placeholder:text-muted-foreground"
              placeholder="Title"
              rows={1}
              value={title}
              onChange={e => {
                onChange(prev => ({ ...prev, title: e.target.value }))
                autoResize(e.target)
                if (editScope !== 'add') onAutoSave?.(viewRef.current?.state.doc.toString().trimEnd() ?? '')
              }}
            />
            {item && (
              <p className="font-mono text-2xs text-muted-foreground mt-0.5">{item.fileSlug}.md</p>
            )}
          </div>
        </div>

        {/* ── FILE-LEVEL: listed-on reverse chips ── */}
        <ListedOnRow
          slugs={linkedSlugs}
          fileSlug={effectiveSlug}
          roots={roots}
          onOpenWikilink={onOpenWikilink}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />

        {/* ── OCCURRENCE-LEVEL: scope (header) → type → metadata → participants ── */}
        <Card className="mt-3 mb-4 overflow-hidden bg-card">
          {showScopeRow && (
            <div className="px-3 pt-3 pb-3 bg-background">
              <Select value={editScope} onValueChange={v => handleScopeChange(v as EditScope)}>
                <SelectTrigger
                  className={cn(
                    badgeVariants({ variant: 'chip' }),
                    'w-fit gap-1 h-auto py-1 text-xs font-medium text-muted-foreground',
                    'border-border shadow-sm',
                    'hover:bg-accent focus:ring-0 focus-visible:ring-1 focus-visible:ring-ring',
                    '[&>svg]:ml-1 [&>svg]:shrink-0 [&>svg]:size-3 [&>svg]:opacity-60',
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="add">Add new occurrence</SelectItem>
                  <SelectItem value="single">Edit this occurrence</SelectItem>
                  {isScheduled && <SelectItem value="future">Edit this and all following occurrences</SelectItem>}
                  {(isScheduled || isAfterCompletion) && <SelectItem value="all">Edit repeat pattern</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )}
          <CardContent className={cn(
            'px-3 pt-3 pb-3 bg-card',
            showScopeRow && 'border-t border-input',
          )}>
            <ToggleGroup
              type="single"
              value={itemType}
              onValueChange={(v) => { if (v) onTypeChange?.(v as ItemType) }}
              className="flex gap-0.75 mb-4 bg-secondary rounded-full p-0.75 border border-input w-fit"
            >
              {(['task', 'event', 'note'] as ItemType[]).map(t => (
                <ToggleGroupItem
                  key={t}
                  value={t}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium text-muted-foreground',
                    'cursor-pointer transition-all whitespace-nowrap capitalize h-auto min-w-0',
                    'data-[state=on]:bg-background data-[state=on]:text-secondary-foreground data-[state=on]:[box-shadow:0_1px_4px_rgb(0_0_0/.35)]',
                    TYPE_CHIP_ACTIVE_CLS[t],
                  )}
                >
                  {t === 'task' && <CheckSquare size={13} />}
                  {t === 'event' && <CalendarDays size={13} />}
                  {t === 'note' && <FileText size={13} />}
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="flex gap-1.5 flex-wrap mb-4">
              {showDateChip && (
                <PropChip icon={Calendar} label="Date" pressed={!!scheduled} onClick={() => onOpenDlg('dlgSched')}
                  value={scheduled ? (fmtShort(parseDateString(scheduled.date) ?? new Date(scheduled.date))) : undefined} />
              )}
              {showDateChip && hasDate && (
                <PropChip icon={Clock} label="Time" pressed={hasTime} onClick={() => onOpenDlg('dlgTime')}
                  value={hasTime ? (fmtT(scheduled!.time, hour12) ?? undefined) : undefined} />
              )}
              {showDateChip && (
                <PropChip icon={Timer} label="Duration" pressed={!!duration} onClick={() => onOpenDlg('dlgDur')}
                  value={duration ? (scheduled ? formatDurationChip(duration, scheduled, hour12) : fmtDuration(duration)) : undefined} />
              )}
              {tracked && (
                <PropChip icon={Flag} label="Priority" pressed={!!priority} onClick={() => onOpenDlg('dlgPriority')}
                  value={priority ? PRIORITY_LABELS[priority] : undefined}
                  className={priority ? PRIORITY_CLASS[priority] : undefined} />
              )}
              {showRepeat && (
                <PropChip icon={Repeat} label="Repeat" pressed={!!repeat} onClick={() => onOpenRepeatDlg(itemType)}
                  value={repeat ? (repeat.type === 'after_completion' ? 'after ✓' : repeat.type || '') : undefined} />
              )}
            </div>

            <ParticipantsRow participants={participants} onChange={ps => {
              const next = { ...entry, participants: ps }
              onChange(() => next)
              onMetaSave?.(next)
            }} allParticipants={allParticipants} />

            {editScope === 'add' && (
              <div className="mt-3 flex justify-end">
                <Button variant="default" size="sm" onClick={() => onSave(viewRef.current?.state.doc.toString().trimEnd() ?? '')}>
                  Save occurrence
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <EntryBody key={bodyKey} body={body} viewRef={viewRef} roots={roots} items={items} onOpenWikilink={onOpenWikilink} onChange={editScope !== 'add' ? onAutoSave : undefined} />

        <ItemsList
          items={listItems}
          onChange={its => {
            const next = { ...entry, items: its }
            onChange(() => next)
            onMetaSave?.(next)
          }}
          roots={roots}
          currentSlug={effectiveSlug ?? null}
          onPromote={handlePromoteTask}
          onOpenWikilink={onOpenWikilink}
          onToggleDone={onToggleDoneBacklink}
        />

      </div></div>
    </>
  )
}
