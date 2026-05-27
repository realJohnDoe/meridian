import { useRef, useEffect, useState, useCallback } from 'react'
import {
  ArrowLeft, Trash2, Check, Calendar, Clock, Timer, Flag, Repeat,
  Plus, CheckSquare, CalendarDays, FileText,
} from 'lucide-react'
import type { Occurrence, Scheduled, Priority, Repeat as RepeatValue } from '../types'
import { useStore } from '../store'
import { NOTES_DATA } from '../meridian'
import { cn } from '../lib/utils'

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
  item: null, title: '', bodyHtml: '', scheduled: null, duration: '',
  tracked: true, itemType: 'task', repeat: null, done: false,
  tags: [], priority: null, editScope: 'all',
}

const PRIORITY_LABELS: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }

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
}

export default function EntryEditor({ entry, onChange, onSave, onDelete, onClose, onOpenDlg, onOpenRepeatDlg, onScopeChange }: Props) {
  const titleRef    = useRef<HTMLTextAreaElement>(null)
  const bodyRef     = useRef<HTMLDivElement>(null)
  const tagInputRef = useRef<HTMLInputElement>(null)
  const [tagInputVal, setTagInputVal] = useState('')
  const [showTagInput, setShowTagInput] = useState(false)

  // ── Wikilink autocomplete ─────────────────────────────────────
  const nodes = useStore(s => s.nodes)
  const [wlMatches,  setWlMatches]  = useState<string[]>([])
  const [wlFocusIdx, setWlFocusIdx] = useState(-1)
  const [wlPopupPos, setWlPopupPos] = useState<{ top: number; left: number } | null>(null)
  const wlOpen = wlMatches.length > 0 && wlPopupPos !== null

  const closeWlPopup = useCallback(() => { setWlMatches([]); setWlPopupPos(null) }, [])

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
    sel.removeAllRanges(); sel.addRange(newRange)
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
      const allTitles = [...new Set([...nodes, ...NOTES_DATA].map(o => o.title))]
      const matches = q ? allTitles.filter(t => t.toLowerCase().includes(q)).slice(0, 8) : allTitles.slice(0, 8)
      if (matches.length) {
        setWlMatches(matches); setWlFocusIdx(-1)
        const rect = range.getBoundingClientRect()
        setWlPopupPos({ top: rect.bottom + 6, left: Math.max(8, rect.left) })
        return
      }
    }
    closeWlPopup()
  }

  function handleBodyKeyDown(e: React.KeyboardEvent) {
    if (!wlOpen) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setWlFocusIdx(i => Math.min(i + 1, wlMatches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setWlFocusIdx(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' && wlFocusIdx >= 0) { e.preventDefault(); insertWikilink(wlMatches[wlFocusIdx]) }
    else if (e.key === 'Escape') closeWlPopup()
  }

  useEffect(() => { if (titleRef.current) autoResize(titleRef.current) }, [entry.title])
  useEffect(() => { if (showTagInput) tagInputRef.current?.focus() }, [showTagInput])

  const commitTag = useCallback(() => {
    const t = tagInputVal.trim()
    if (t) onChange(prev => ({ ...prev, tags: [...prev.tags, t] }))
    setTagInputVal(''); setShowTagInput(false)
  }, [tagInputVal, onChange])

  const { item, title, bodyHtml, scheduled, duration, tracked, itemType, repeat, done, tags, priority, editScope } = entry

  const isRecur          = !!(item && (item.recur || item._node?.repeat || item.repeat))
  const isScheduled      = !!(item && (item._node?.repeat?.type === 'schedule' || item.repeat?.type === 'schedule'))
  const isAfterCompletion= !!(item && (item._node?.repeat?.type === 'after_completion' || item.repeat?.type === 'after_completion'))
  const hasSched         = !!(item && (item.date || item._node?.date))
  const fname = item
    ? ((item._node?.id || item._nodeId || item.id || item.title || 'untitled') + '.md').toLowerCase().replace(/\s+/g, '-')
    : 'untitled.md'

  const hasDate       = !!scheduled
  const hasTime       = !!(scheduled?.time)
  const isSingleScope = editScope === 'single'
  const isNote        = itemType === 'note'
  const showDateChip  = !isNote
  const showRepeat    = !isNote && (hasDate || tracked) && !isSingleScope
  const showScopeRow  = isRecur || hasSched

  const bodyKey = item ? `${item._nodeId || item.id || 'item'}-${item.date || ''}-${editScope}` : 'new'

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (bodyRef.current) bodyRef.current.innerHTML = bodyHtml }, [bodyKey])

  function handleTypeChange(t: ItemType) {
    onChange(prev => ({ ...prev, itemType: t, tracked: t === 'task', priority: t !== 'task' ? null : prev.priority }))
  }

  function handleScopeChange(scope: string) {
    onChange(prev => ({ ...prev, editScope: scope }))
    onScopeChange?.(scope)
  }

  // ── Shared primitive classes ──────────────────────────────────
  const pchipBase = 'inline-flex items-center gap-[5px] px-3 py-1.5 rounded-[20px] text-[12px] font-medium border cursor-pointer transition-all duration-[140ms] whitespace-nowrap [&_svg]:w-[13px] [&_svg]:h-[13px] [&_svg]:shrink-0'

  const pchipCls = (on: boolean, extra = '') => cn(
    pchipBase,
    on ? cn('bg-ab2 border-ind text-ind', extra) : 'bg-bg3 border-bdr2 text-t2',
  )

  const priorityCls = cn(
    pchipBase,
    !tracked ? 'hidden' : '',
    priority
      ? cn('border', {
          'bg-[rgba(248,113,113,.15)] border-p1 text-p1': priority === 'high',
          'bg-[rgba(251,146,60,.15)]  border-p2 text-p2': priority === 'medium',
          'bg-[rgba(250,204,21,.15)]  border-p3 text-p3': priority === 'low',
        })
      : 'bg-bg3 border-bdr2 text-t2',
  )

  return (
    <>
      {/* Header */}
      <div className="h-[var(--th)] flex items-center gap-2 px-3 border-b border-bdr shrink-0 bg-bg1">
        <button
          className="size-[34px] rounded-full flex items-center justify-center text-t2 transition-colors hover:bg-bg3 hover:text-t0 shrink-0"
          onClick={onClose}
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>
        <span className="flex-1 font-mono text-[11px] text-t3 overflow-hidden text-ellipsis whitespace-nowrap">{fname}</span>
        {item && (
          <button
            className="size-[34px] rounded-full flex items-center justify-center transition-colors hover:bg-bg3 shrink-0 text-ros"
            onClick={onDelete}
            title="Delete"
          >
            <Trash2 size={18} strokeWidth={1.8} />
          </button>
        )}
        <button
          className="text-[13px] font-semibold text-white bg-gradient-to-br from-ind2 to-cyn2 px-4 py-1.5 rounded-[20px] shadow-[0_2px_12px_rgba(99,102,241,.3)]"
          onClick={() => onSave(bodyRef.current?.innerText?.trim() ?? '')}
        >
          Save
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="pt-[18px] px-3.5 pb-[120px]">

          {/* Title row */}
          <div className="flex items-start gap-[10px] mb-4">
            {tracked && (
              <div
                className={cn(
                  'size-6 rounded-full border-2 flex items-center justify-center shrink-0 mt-1 cursor-pointer transition-all',
                  done ? 'bg-grn border-grn' : 'border-bg4',
                )}
                onClick={() => onChange(prev => ({ ...prev, done: !prev.done }))}
              >
                <Check size={12} className={cn('stroke-white fill-none', done ? 'opacity-100' : 'opacity-0')} strokeWidth={2.5} />
              </div>
            )}
            <textarea
              ref={titleRef}
              className="flex-1 font-display text-[22px] font-light text-t0 bg-transparent border-0 outline-none leading-[1.3] resize-none min-h-9 placeholder:text-t3"
              placeholder="Title"
              rows={1}
              value={title}
              onChange={e => { onChange(prev => ({ ...prev, title: e.target.value })); autoResize(e.target) }}
            />
          </div>

          {/* Type switcher */}
          <div className="flex gap-[3px] mb-4 bg-bg3 rounded-[22px] p-[3px] border border-bdr2 w-fit">
            {(['task', 'event', 'note'] as ItemType[]).map(t => (
              <button
                key={t}
                className={cn(
                  'inline-flex items-center gap-[5px] px-3.5 py-[5px] rounded-[18px] text-[12px] font-medium cursor-pointer transition-all duration-150 whitespace-nowrap capitalize [&_svg]:w-[13px] [&_svg]:h-[13px]',
                  itemType === t
                    ? cn('bg-bg1 shadow-[0_1px_4px_rgba(0,0,0,.35)]', {
                        'text-grn': t === 'task',
                        'text-ind': t === 'event',
                        'text-amb': t === 'note',
                      })
                    : 'text-t3',
                )}
                onClick={() => handleTypeChange(t)}
              >
                {t === 'task'  && <CheckSquare size={13} />}
                {t === 'event' && <CalendarDays size={13} />}
                {t === 'note'  && <FileText size={13} />}
                {t}
              </button>
            ))}
          </div>

          {/* Scope selector (recurring/scheduled items) */}
          {showScopeRow && (
            <div className="flex items-center gap-2 mb-3.5 px-3 py-[7px] bg-bg2 border border-bdr2 rounded-[10px]">
              <span className="text-[11px] font-semibold tracking-[.06em] uppercase text-t3 whitespace-nowrap">Scope</span>
              <select
                className="flex-1 bg-bg3 border border-bdr2 rounded-[8px] px-2 py-[5px] text-[12px] font-medium text-ind cursor-pointer outline-none font-sans transition-colors focus:border-ind"
                value={editScope}
                onChange={e => handleScopeChange(e.target.value)}
              >
                <option value="add">Add new occurrence</option>
                <option value="single">Edit this occurrence</option>
                {isScheduled      && <option value="future">Edit this and all following occurrences</option>}
                {(isScheduled || isAfterCompletion) && <option value="all">Edit repeat pattern</option>}
              </select>
            </div>
          )}

          {/* Property chips */}
          <div className="flex gap-1.5 flex-wrap mb-4">
            {showDateChip && (
              <button className={pchipCls(!!scheduled)} onClick={() => onOpenDlg('dlgSched')}>
                <Calendar />Date
                <span className="text-[11px] font-mono opacity-80 ml-px">
                  {scheduled ? scheduled.date.slice(5).replace('-', '/') : ''}
                </span>
              </button>
            )}
            {showDateChip && (
              <button className={cn(pchipCls(hasTime), !hasDate && 'hidden')} onClick={() => onOpenDlg('dlgTime')}>
                <Clock />Time
                <span className="text-[11px] font-mono opacity-80 ml-px">{hasTime ? scheduled!.time : ''}</span>
              </button>
            )}
            {showDateChip && (
              <button className={cn(pchipCls(!!duration), !hasDate && 'hidden')} onClick={() => onOpenDlg('dlgDur')}>
                <Timer />Duration
                <span className="text-[11px] font-mono opacity-80 ml-px">{duration}</span>
              </button>
            )}
            <button className={priorityCls} onClick={() => onOpenDlg('dlgPriority')}>
              <Flag />Priority
              <span className="text-[11px] font-mono opacity-80 ml-px">{priority ? PRIORITY_LABELS[priority] : ''}</span>
            </button>
            {showRepeat && (
              <button className={pchipCls(!!repeat)} onClick={() => onOpenRepeatDlg(itemType)}>
                <Repeat />Repeat
                <span className="text-[11px] font-mono opacity-80 ml-px">
                  {repeat ? (repeat.type === 'after_completion' ? 'after ✓' : repeat.type || '') : ''}
                </span>
              </button>
            )}
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-[5px] mb-4 items-center">
            {tags.map((t, i) => (
              <span key={i} className="bg-bg3 border border-bdr2 rounded-[20px] px-[10px] py-[3px] text-[11px] text-t2">{t}</span>
            ))}
            {showTagInput ? (
              <input
                ref={tagInputRef}
                className="bg-bg3 border border-ind rounded-[20px] px-[10px] py-[3px] text-[11px] text-t0 outline-none w-[90px] placeholder:text-t3"
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
              <span
                className="bg-ab border border-ind rounded-[20px] px-[10px] py-[3px] text-[11px] text-ind cursor-pointer inline-flex items-center gap-1"
                onClick={() => setShowTagInput(true)}
              >
                <Plus size={11} strokeWidth={2.5} /> tag
              </span>
            )}
          </div>

          <div className="h-px bg-bdr mb-3.5" />

          {/* Body editor — .wl and .wl-broken child rules live in index.css */}
          <div
            key={bodyKey}
            ref={bodyRef}
            className="entry-body min-h-[160px] text-t1 text-[14px] leading-[1.85] outline-none caret-ind whitespace-pre-wrap break-words relative"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            onInput={handleBodyInput}
            onKeyDown={handleBodyKeyDown}
          />

        </div>
      </div>

      {/* Wikilink autocomplete popup */}
      {wlOpen && wlPopupPos && (
        <div
          className="fixed z-[500] min-w-[210px] max-h-[200px] overflow-y-auto bg-bg2 border border-bdr2 rounded-[10px] shadow-[0_8px_32px_rgba(0,0,0,.4)]"
          style={{ top: wlPopupPos.top, left: wlPopupPos.left }}
        >
          {wlMatches.map((t, i) => {
            const match = nodes.find(n => n.title === t) ?? NOTES_DATA.find(n => n.title === t)
            const Icon = (match && 'done' in match && match.done !== undefined) ? CheckSquare
              : (match && 'time' in match && (match as { time?: string }).time) ? Calendar
              : FileText
            return (
              <div
                key={t}
                className={cn(
                  'px-3.5 py-[9px] cursor-pointer text-[13px] text-t1 transition-colors flex items-center gap-2',
                  i === wlFocusIdx ? 'bg-bg3' : 'hover:bg-bg3',
                )}
                onMouseDown={e => { e.preventDefault(); insertWikilink(t) }}
              >
                <Icon size={13} className="stroke-t3 fill-none shrink-0" strokeWidth={1.8} />
                {t}
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
