import React, { useRef, useEffect, useState, useCallback } from 'react'
import { ArrowLeft, Trash2, Calendar, Clock, Timer, Flag, Repeat, Plus, CheckSquare, CalendarDays, FileText, Users, Tag } from 'lucide-react'
import type { Occurrence, Scheduled, Priority, Repeat as RepeatValue, StoreItem, Roots } from '../types'
import { TODAY } from '../constants'
import { fmtISO } from '../model/expansion'
import { isSeries } from '../types'
import { fileEntries } from '../presentation'
import { Badge, badgeVariants } from './ui/badge'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Checkbox } from './ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Card, CardContent } from './ui/card'
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from './ui/command'
import TagChip from './TagChip'
import BacklinksPanel from './BacklinksPanel'
import { unwrapRef, resolveWikilink } from '../wikilinks'
import { cn } from '@/lib/utils'

export type { Scheduled }

export type ItemType = 'task' | 'event' | 'note'

export interface EntryState {
  item: Occurrence | null
  title: string
  bodyHtml: string
  scheduled: Scheduled | null
  duration: string
  tracked: boolean
  itemType: ItemType
  repeat: RepeatValue | null
  done: boolean
  tags: string[]
  topics: string[]
  participants: string[]
  priority: Priority | null
  editScope: string
}

export const ENTRY_DEFAULT: EntryState = {
  item: null,
  title: '',
  bodyHtml: '',
  scheduled: null,
  duration: '',
  tracked: true,
  itemType: 'task',
  repeat: null,
  done: false,
  tags: [],
  topics: [],
  participants: [],
  priority: null,
  editScope: 'all',
}

const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
// Tailwind classes that override the chip's default aria-pressed indigo colour.
// Tokens are defined via @theme inline in index.css — colours stay in CSS, not JS.
const PRIORITY_CLASS: Record<string, string> = {
  high:   'aria-[pressed=true]:bg-p1/15 aria-[pressed=true]:border-p1 aria-[pressed=true]:text-p1',
  medium: 'aria-[pressed=true]:bg-p2/15 aria-[pressed=true]:border-p2 aria-[pressed=true]:text-p2',
  low:    'aria-[pressed=true]:bg-p3/15 aria-[pressed=true]:border-p3 aria-[pressed=true]:text-p3',
}

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

interface Props {
  entry: EntryState
  onChange: (updater: (prev: EntryState) => EntryState) => void
  onSave: (body: string) => void
  onDelete: () => void
  onClose: () => void
  onOpenDlg: (id: string) => void
  onOpenRepeatDlg: (itemType: ItemType) => void
  onScopeChange?: (scope: string) => void
  /** StoreItem[] to resolve parent series against. */
  items: StoreItem[]
  /** Roots map for wikilink autocomplete. App passes global roots; debug passes local roots. */
  roots: Roots
  /** Called when the user clicks a wikilink chip or body link — navigate to that file. */
  onOpenWikilink?: (ref: string) => void
  /** Called when the user toggles done on a backlink card. */
  onToggleDoneBacklink?: (occ: Occurrence) => void
}

export default function EntryEditor({ entry, onChange, onSave, onDelete, onClose, onOpenDlg, onOpenRepeatDlg, onScopeChange, items, roots, onOpenWikilink, onToggleDoneBacklink }: Props) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [participantInputVal, setParticipantInputVal] = useState('')
  const [showParticipantInput, setShowParticipantInput] = useState(false)
  const participantInputRef = useRef<HTMLInputElement>(null)

  // ── Tag/topic picker state ──────────────────────────────────────
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerQuery, setPickerQuery] = useState('')

  // ── Wikilink autocomplete state (body editor) ───────────────────
  const [wlMatches, setWlMatches] = useState<string[]>([])
  const [wlFocusIdx, setWlFocusIdx] = useState(-1)
  const [wlPopupPos, setWlPopupPos] = useState<{ top: number; left: number } | null>(null)
  const wlOpen = wlMatches.length > 0 && wlPopupPos !== null

  const closeWlPopup = useCallback(() => {
    setWlMatches([])
    setWlPopupPos(null)
  }, [])

  // Close popup when clicking outside the body editor.
  useEffect(() => {
    if (!wlOpen) return
    const handler = (e: MouseEvent) => {
      if (!bodyRef.current?.contains(e.target as Node)) closeWlPopup()
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [wlOpen, closeWlPopup])

  const insertWikilink = useCallback((title: string) => {
    closeWlPopup()
    const sel = window.getSelection()
    if (!sel?.rangeCount || !bodyRef.current) return
    const range = sel.getRangeAt(0)
    const preRange = document.createRange()
    preRange.setStart(bodyRef.current, 0)
    try { preRange.setEnd(range.startContainer, range.startOffset) } catch { return }
    const before = preRange.toString()
    if (before.lastIndexOf('[[') === -1) return
    const textNode = range.startContainer
    const pos = range.startOffset
    const fullText = textNode.textContent ?? ''
    const localOpen = fullText.lastIndexOf('[[', pos - 1)
    if (localOpen === -1) return
    textNode.textContent = fullText.slice(0, localOpen) + '[[' + title + ']]' + fullText.slice(pos)
    const newPos = localOpen + title.length + 4
    const newRange = document.createRange()
    newRange.setStart(textNode, Math.min(newPos, (textNode.textContent ?? '').length))
    newRange.collapse(true)
    sel.removeAllRanges()
    sel.addRange(newRange)
  }, [closeWlPopup])

  function handleBodyInput() {
    if (!bodyRef.current) return
    const sel = window.getSelection()
    if (!sel?.rangeCount) { closeWlPopup(); return }
    const range = sel.getRangeAt(0)
    if (!bodyRef.current.contains(range.startContainer)) { closeWlPopup(); return }
    const preRange = document.createRange()
    preRange.setStart(bodyRef.current, 0)
    try { preRange.setEnd(range.startContainer, range.startOffset) } catch { closeWlPopup(); return }
    const before = preRange.toString()
    const m = before.match(/\[\[([^\]\n]*)$/)
    if (m) {
      const q = m[1].toLowerCase()
      const allTitles = fileEntries(roots).map(e => e.title)
      const matches = q
        ? allTitles.filter(t => t.toLowerCase().includes(q)).slice(0, 8)
        : allTitles.slice(0, 8)
      if (matches.length) {
        setWlMatches(matches)
        setWlFocusIdx(-1)
        const rect = range.getBoundingClientRect()
        setWlPopupPos({ top: rect.bottom + 6, left: Math.max(8, rect.left) })
        return
      }
    }
    closeWlPopup()
  }

  function handleBodyKeyDown(e: React.KeyboardEvent) {
    if (!wlOpen) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setWlFocusIdx(i => Math.min(i + 1, wlMatches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setWlFocusIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && wlFocusIdx >= 0) {
      e.preventDefault()
      insertWikilink(wlMatches[wlFocusIdx])
    } else if (e.key === 'Escape') {
      closeWlPopup()
    }
  }

  useEffect(() => {
    if (titleRef.current) autoResize(titleRef.current)
  }, [entry.title])

  useEffect(() => {
    if (showParticipantInput) participantInputRef.current?.focus()
  }, [showParticipantInput])

  const commitParticipant = useCallback(() => {
    const p = participantInputVal.trim()
    if (p) onChange(prev => ({ ...prev, participants: [...prev.participants, p] }))
    setParticipantInputVal('')
    setShowParticipantInput(false)
  }, [participantInputVal, onChange])

  // ── Tag/topic actions ───────────────────────────────────────────
  const removeTag = useCallback((idx: number) => {
    onChange(prev => ({ ...prev, tags: prev.tags.filter((_, i) => i !== idx) }))
  }, [onChange])

  const removeTopic = useCallback((idx: number) => {
    onChange(prev => ({ ...prev, topics: prev.topics.filter((_, i) => i !== idx) }))
  }, [onChange])

  /**
   * Add a plain-text tag (free text from the picker input).
   * Rejects empty strings and duplicates.
   */
  const addTag = useCallback((raw: string) => {
    const t = raw.trim()
    if (!t) return
    onChange(prev => prev.tags.includes(t) ? prev : { ...prev, tags: [...prev.tags, t] })
    setPickerQuery('')
    setPickerOpen(false)
  }, [onChange])

  /**
   * Add a wikilink topic by fileSlug (stored as `[[fileSlug]]`).
   * Rejects duplicates.
   */
  const addTopic = useCallback((fileSlug: string) => {
    const stored = `[[${fileSlug}]]`
    onChange(prev => prev.topics.includes(stored) ? prev : { ...prev, topics: [...prev.topics, stored] })
    setPickerQuery('')
    setPickerOpen(false)
  }, [onChange])

  // Build the mixed, alphabetically-sorted chip list for the tag/topic row.
  type ChipEntry = { label: string; isTopic: boolean; idx: number; raw: string }
  const { tags, topics } = entry
  const tagChips: ChipEntry[] = tags.map((t, i) => ({ label: t, isTopic: false, idx: i, raw: t }))
  const topicChips: ChipEntry[] = topics.map((raw, i) => {
    const ref = unwrapRef(raw)
    const fileSlug = resolveWikilink(ref, roots)
    const label = fileSlug ? (roots.get(fileSlug)?.title ?? ref) : ref
    return { label, isTopic: true, idx: i, raw }
  })
  const allChips = [...tagChips, ...topicChips].sort((a, b) => a.label.localeCompare(b.label))

  // File entries for the picker combobox.
  const allFileEntries = fileEntries(roots)
  const filteredEntries = pickerQuery
    ? allFileEntries.filter(e => e.title.toLowerCase().includes(pickerQuery.toLowerCase()))
    : allFileEntries

  const { item, title, bodyHtml, scheduled, duration, tracked, itemType, repeat, done, participants, priority, editScope } = entry

  const parentSeries = item?.ownerId ? items.find(i => isSeries(i) && i.id === item.ownerId) : null
  const isRecur = !!(item && item.ownerId)
  const seriesRepeat = (parentSeries && isSeries(parentSeries)) ? parentSeries.repeat : null
  const isScheduled = !!(item && seriesRepeat?.type === 'schedule')
  const isAfterCompletion = !!(item && seriesRepeat?.type === 'after_completion')
  const hasSched = !!(item && item.date)
  const fname = item
    ? ((item.fileSlug || item.metadata?.title || 'untitled') + '.md').toLowerCase().replace(/\s+/g, '-')
    : 'untitled.md'

  const hasDate = !!scheduled
  const hasTime = !!(scheduled?.time)
  const isSingleScope = editScope === 'single'
  const isNote = itemType === 'note'

  /** Pick the right type icon for a file entry in the topic combobox. */
  function entryTypeIcon(fileSlug: string) {
    const first = items.find(i => i.fileSlug === fileSlug)
    if (first && first.metadata.done !== undefined) return <CheckSquare size={13} className="shrink-0 opacity-60" />
    if (first && first.date) return <CalendarDays size={13} className="shrink-0 opacity-60" />
    return <FileText size={13} className="shrink-0 opacity-60" />
  }
  // notes: no scheduling chips; events: date/time/duration + repeat (schedule only); tasks: everything
  const showDateChip = !isNote
  const showRepeat = !isNote && (hasDate || tracked) && (!isSingleScope || !isRecur)
  const bodyKey = item ? `${item.fileSlug || 'item'}-${item.date || ''}-${editScope}` : 'new'

  // Set body HTML imperatively so React never touches innerHTML during re-renders
  // triggered by wikilink state updates. bodyKey changes when a new entry is opened
  // or the edit scope changes, remounting the div via key= and re-running this effect.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (bodyRef.current) bodyRef.current.innerHTML = bodyHtml }, [bodyKey])

  const showScopeRow = isRecur || hasSched

  function handleTypeChange(t: ItemType) {
    onChange(prev => ({
      ...prev,
      itemType: t,
      tracked: t === 'task',
      priority: t !== 'task' ? null : prev.priority,
      scheduled:
        t === 'note'                         ? null
        : t === 'event' && !prev.scheduled   ? { date: fmtISO(TODAY), time: '' }
        : prev.scheduled,
    }))
  }

  function handleScopeChange(scope: string) {
    onChange(prev => ({ ...prev, editScope: scope }))
    onScopeChange?.(scope)
  }

  return (
    <>
      <div className="entry-top">
        <button className="ib" onClick={onClose}><ArrowLeft /></button>
        <span className="entry-fname">{fname}</span>
        {item && (
          <button className="ib" onClick={onDelete} title="Delete" style={{ color: 'var(--ros)' }}>
            <Trash2 />
          </button>
        )}
        <button className="save-btn" onClick={() => onSave(bodyRef.current?.innerText?.trim() ?? '')}>Save</button>
      </div>

      <div className="entry-sc"><div className="entry-pad">

        {/* ── FILE-LEVEL: title ── */}
        <div className="entry-title-row">
          {tracked && (
            <Checkbox
              checked={done}
              onCheckedChange={() => onChange(prev => ({ ...prev, done: !prev.done }))}
              className="size-6 mt-1"
            />
          )}
          <textarea
            ref={titleRef}
            className="entry-title-in"
            placeholder="Title"
            rows={1}
            value={title}
            onChange={e => { onChange(prev => ({ ...prev, title: e.target.value })); autoResize(e.target) }}
          />
        </div>

        {/* ── FILE-LEVEL: tags + topics ── */}
        <div className="entry-tags">
          {allChips.map(c => (
            c.isTopic
              ? <TagChip
                  key={c.raw}
                  label={c.label}
                  isTopic
                  interactive
                  onRemove={() => removeTopic(c.idx)}
                  onNavigate={onOpenWikilink ? () => onOpenWikilink(unwrapRef(c.raw)) : undefined}
                />
              : <TagChip
                  key={`tag:${c.idx}`}
                  label={c.label}
                  interactive
                  onRemove={() => removeTag(c.idx)}
                />
          ))}

          {/* Merged add affordance: combobox picker */}
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Badge
                variant="tag"
                className="cursor-pointer text-primary bg-[var(--ab)] gap-1"
                onClick={() => setPickerOpen(true)}
              >
                <Plus size={9} /><Tag size={9} />add
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
              <Command shouldFilter={false}>
                <CommandInput
                  placeholder="Tag or link file…"
                  value={pickerQuery}
                  onValueChange={setPickerQuery}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && pickerQuery.trim() && filteredEntries.length === 0) {
                      addTag(pickerQuery)
                    }
                  }}
                />
                <CommandList>
                  {/* "Add as tag" option — always shown when there's a query */}
                  {pickerQuery.trim() && (
                    <CommandGroup heading="Tag">
                      <CommandItem
                        value={`__tag__${pickerQuery}`}
                        onSelect={() => addTag(pickerQuery)}
                      >
                        <Tag size={13} className="shrink-0 opacity-60" />
                        <span>Add <strong>"{pickerQuery.trim()}"</strong> as tag</span>
                      </CommandItem>
                    </CommandGroup>
                  )}

                  {/* File entries for linking */}
                  {filteredEntries.length > 0 && (
                    <CommandGroup heading="Link file">
                      {filteredEntries.slice(0, 8).map(e => (
                        <CommandItem
                          key={e.fileSlug}
                          value={e.fileSlug}
                          onSelect={() => addTopic(e.fileSlug)}
                        >
                          {entryTypeIcon(e.fileSlug)}
                          <span className="truncate">{e.title}</span>
                          {e.tags[0] && (
                            <span className="ml-auto text-[10px] text-[var(--t3)] shrink-0">{e.tags[0]}</span>
                          )}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {!pickerQuery && filteredEntries.length === 0 && (
                    <CommandEmpty>No files found</CommandEmpty>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {/* ── OCCURRENCE-LEVEL: scope (header) → type → metadata → participants ── */}
        <Card className="mt-3 mb-4 overflow-hidden bg-[var(--bg2)]">
          {showScopeRow && (
            <div className="px-3 py-2.5 bg-[var(--bg1)]">
              <Select value={editScope} onValueChange={handleScopeChange}>
                <SelectTrigger className="w-full border-0 shadow-none bg-transparent p-0 h-auto text-sm font-medium text-[var(--t2)] focus:ring-0 hover:bg-transparent [&>svg]:ml-auto [&>svg]:shrink-0">
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
            'px-3 pt-3 pb-3 bg-[var(--bg2)]',
            showScopeRow && 'border-t border-[var(--bdr2)]',
          )}>
            <ToggleGroup
              type="single"
              value={itemType}
              onValueChange={(v) => { if (v) handleTypeChange(v as ItemType) }}
              className="type-chip-row"
            >
              {(['task', 'event', 'note'] as ItemType[]).map(t => (
                <ToggleGroupItem
                  key={t}
                  value={t}
                  className={cn('type-chip', `type-chip-${t}`, 'h-auto min-w-0')}
                >
                  {t === 'task' && <CheckSquare size={13} />}
                  {t === 'event' && <CalendarDays size={13} />}
                  {t === 'note' && <FileText size={13} />}
                  {t}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="prop-chips">
              {showDateChip && (
                <button className={badgeVariants({ variant: 'chip' })} aria-pressed={!!scheduled} onClick={() => onOpenDlg('dlgSched')}>
                  <Calendar size={13} />Date
                  <span className="text-[11px] font-mono opacity-80 ml-px">{scheduled ? scheduled.date.slice(5).replace('-', '/') : ''}</span>
                </button>
              )}
              {showDateChip && hasDate && (
                <button className={badgeVariants({ variant: 'chip' })} aria-pressed={hasTime} onClick={() => onOpenDlg('dlgTime')}>
                  <Clock size={13} />Time
                  <span className="text-[11px] font-mono opacity-80 ml-px">{hasTime ? scheduled!.time : ''}</span>
                </button>
              )}
              {showDateChip && hasDate && (
                <button className={badgeVariants({ variant: 'chip' })} aria-pressed={!!duration} onClick={() => onOpenDlg('dlgDur')}>
                  <Timer size={13} />Duration
                  <span className="text-[11px] font-mono opacity-80 ml-px">{duration}</span>
                </button>
              )}
              {tracked && (
                <button
                  className={cn(badgeVariants({ variant: 'chip' }), priority && PRIORITY_CLASS[priority])}
                  aria-pressed={!!priority}
                  onClick={() => onOpenDlg('dlgPriority')}
                >
                  <Flag size={13} />Priority
                  <span className="text-[11px] font-mono opacity-80 ml-px">{priority ? PRIORITY_LABELS[priority] : ''}</span>
                </button>
              )}
              {showRepeat && (
                <button className={badgeVariants({ variant: 'chip' })} aria-pressed={!!repeat} onClick={() => onOpenRepeatDlg(itemType)}>
                  <Repeat size={13} />Repeat
                  <span className="text-[11px] font-mono opacity-80 ml-px">{repeat ? (repeat.type === 'after_completion' ? 'after ✓' : repeat.type || '') : ''}</span>
                </button>
              )}
            </div>

            <div className="entry-tags !mb-0">
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
              {showParticipantInput ? (
                <input
                  ref={participantInputRef}
                  className="etag-input"
                  value={participantInputVal}
                  placeholder="name"
                  onChange={e => setParticipantInputVal(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); commitParticipant() }
                    if (e.key === 'Escape') { setParticipantInputVal(''); setShowParticipantInput(false) }
                  }}
                  onBlur={commitParticipant}
                />
              ) : (
                <Badge
                  variant="tag"
                  className="cursor-pointer text-primary bg-[var(--ab)] gap-1"
                  onClick={() => setShowParticipantInput(true)}
                >
                  <Plus size={9} />person
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <div
          key={bodyKey}
          ref={bodyRef}
          className="entry-body"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={handleBodyInput}
          onKeyDown={handleBodyKeyDown}
        />

        {item?.fileSlug && onOpenWikilink && onToggleDoneBacklink && (
          <BacklinksPanel
            fileSlug={item.fileSlug}
            items={items}
            roots={roots}
            onOpen={onOpenWikilink}
            onToggleDone={onToggleDoneBacklink}
          />
        )}

      </div></div>

      {/* ── WIKILINK AUTOCOMPLETE POPUP (body editor) ── */}
      {wlOpen && wlPopupPos && (
        <div className="wl-popup show" style={{ top: wlPopupPos.top, left: wlPopupPos.left }}>
          {wlMatches.map((t, i) => {
            // Determine icon: look for a series or timed occurrence in the matching file
            const rootFileSlug = [...roots.entries()].find(([, r]) => r.title === t)?.[0]
            const matchItem = rootFileSlug ? items.find(i => i.fileSlug === rootFileSlug && !isSeries(i)) : undefined
            const Icon = matchItem && (matchItem as { metadata?: { done?: boolean } }).metadata?.done !== undefined ? CheckSquare
              : matchItem && matchItem.time ? Calendar
              : FileText
            return (
              <div
                key={t}
                className={`wl-item${i === wlFocusIdx ? ' focused' : ''}`}
                onMouseDown={e => { e.preventDefault(); insertWikilink(t) }}
              >
                <Icon size={13} />
                {t}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
