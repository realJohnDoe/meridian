import React, { useRef, useEffect, useState, useCallback } from 'react'
import { ArrowLeft, Trash2, Calendar, Clock, Timer, Flag, Repeat, Plus, CheckSquare, CalendarDays, FileText } from 'lucide-react'
import type { Occurrence, Scheduled, Priority, Repeat as RepeatValue, StoreItem } from '../types'
import { isSeries } from '../types'
import { NOTES_DATA } from '../meridian'
import { Badge, badgeVariants } from './ui/badge'
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group'
import { Checkbox } from './ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
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
  /** StoreItem[] to resolve wikilinks and parent series against. App passes global items; debug passes local items. */
  items: StoreItem[]
}

export default function EntryEditor({ entry, onChange, onSave, onDelete, onClose, onOpenDlg, onOpenRepeatDlg, onScopeChange, items }: Props) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)
  const [tagInputVal, setTagInputVal] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)

  // ── Wikilink autocomplete state ───────────────────────────────
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
      const allTitles = [...new Set([...items.map(i => i.metadata.title), ...NOTES_DATA.map(n => n.title)])]
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

  // Focus the tag input as soon as it appears.
  useEffect(() => {
    if (showTagInput) tagInputRef.current?.focus()
  }, [showTagInput])

  const commitTag = useCallback(() => {
    const t = tagInputVal.trim()
    if (t) onChange(prev => ({ ...prev, tags: [...prev.tags, t] }))
    setTagInputVal('')
    setShowTagInput(false)
  }, [tagInputVal, onChange])

  const { item, title, bodyHtml, scheduled, duration, tracked, itemType, repeat, done, tags, priority, editScope } = entry

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

        {showScopeRow && (
          <div className="scope-row">
            <Select value={editScope} onValueChange={handleScopeChange}>
              <SelectTrigger className="flex-1">
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

        <div className="entry-tags">
          {tags.map((t, i) => (
            <Badge key={i} variant="tag">{t}</Badge>
          ))}
          {showTagInput ? (
            <input
              ref={tagInputRef}
              className="etag-input"
              value={tagInputVal}
              placeholder="tag name"
              onChange={e => setTagInputVal(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitTag() }
                if (e.key === 'Escape') { setTagInputVal(''); setShowTagInput(false) }
              }}
              onBlur={commitTag}
            />
          ) : (
            <Badge
              variant="tag"
              className="cursor-pointer text-primary bg-[var(--ab)] gap-1"
              onClick={() => setShowTagInput(true)}
            >
              <Plus size={9} />tag
            </Badge>
          )}
        </div>

        <div className="entry-divider"></div>

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

      </div></div>

      {/* ── WIKILINK AUTOCOMPLETE POPUP ── */}
      {wlOpen && wlPopupPos && (
        <div className="wl-popup show" style={{ top: wlPopupPos.top, left: wlPopupPos.left }}>
          {wlMatches.map((t, i) => {
            const matchItem = items.find(i => i.metadata.title === t)
            const matchNote = NOTES_DATA.find(n => n.title === t)
            const Icon = (matchItem && matchItem.metadata.done !== undefined) ? CheckSquare
              : (matchItem && 'time' in matchItem && matchItem.time) ? Calendar
              : matchNote ? FileText
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
