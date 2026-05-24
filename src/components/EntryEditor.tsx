import { useRef, useEffect } from 'react'
import { ArrowLeft, Trash2, Check, Calendar, Clock, Timer, Flag, Repeat, Plus, CheckSquare, CalendarDays, FileText } from 'lucide-react'
import type { Occurrence, Scheduled, Priority, Repeat as RepeatValue } from '../types'

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
const PRIORITY_CLASS: Record<string, string> = { high: 'p1', medium: 'p2', low: 'p3' }

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
  onOpenRepeatDlg: () => void
  onScopeChange?: (scope: string) => void
}

export default function EntryEditor({ entry, onChange, onSave, onDelete, onClose, onOpenDlg, onOpenRepeatDlg, onScopeChange }: Props) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (titleRef.current) autoResize(titleRef.current)
  }, [entry.title])

  const { item, title, bodyHtml, scheduled, duration, tracked, itemType, repeat, done, tags, priority, editScope } = entry

  const isRecur = !!(item && (item.recur || item._node?.repeat || item.repeat))
  const isScheduled = !!(item && (item._node?.repeat?.type === 'schedule' || item.repeat?.type === 'schedule'))
  const isAfterCompletion = !!(item && (item._node?.repeat?.type === 'after_completion' || item.repeat?.type === 'after_completion'))
  const hasSched = !!(item && (item.date || item._node?.date))
  const fname = item
    ? ((item._node?.id || item._nodeId || item.id || item.title || 'untitled') + '.md').toLowerCase().replace(/\s+/g, '-')
    : 'untitled.md'

  const hasDate = !!scheduled
  const hasTime = !!(scheduled?.time)
  const isSingleScope = editScope === 'single'
  const showRepeat = (hasDate || tracked) && !isSingleScope
  const priorityChipClass = ['pchip', !tracked ? 'hidden' : '', priority ? 'on' : '', priority ? PRIORITY_CLASS[priority] : ''].filter(Boolean).join(' ')
  const bodyKey = item ? `${item._nodeId || item.id || 'item'}-${item.date || ''}-${editScope}` : 'new'

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
            <div
              className={['echk', 'show', done ? 'on' : ''].filter(Boolean).join(' ')}
              onClick={() => onChange(prev => ({ ...prev, done: !prev.done }))}
            >
              <Check />
            </div>
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

        <div className="type-chip-row">
          {(['task', 'event', 'note'] as ItemType[]).map(t => (
            <button
              key={t}
              className={`type-chip type-chip-${t}${itemType === t ? ' active' : ''}`}
              onClick={() => handleTypeChange(t)}
            >
              {t === 'task' && <CheckSquare size={13} />}
              {t === 'event' && <CalendarDays size={13} />}
              {t === 'note' && <FileText size={13} />}
              {t}
            </button>
          ))}
        </div>

        {showScopeRow && (
          <div className="scope-row">
            <select className="scope-select" value={editScope} onChange={e => handleScopeChange(e.target.value)}>
              <option value="add">Add new occurrence</option>
              <option value="single">Edit this occurrence</option>
              {isScheduled && <option value="future">Edit this and all following occurrences</option>}
              {(isScheduled || isAfterCompletion) && <option value="all">Edit repeat pattern</option>}
            </select>
          </div>
        )}

        <div className="prop-chips">
          <button className={`pchip${scheduled ? ' on' : ''}`} onClick={() => onOpenDlg('dlgSched')}>
            <Calendar />Date
            <span className="pchip-sum">{scheduled ? scheduled.date.slice(5).replace('-', '/') : ''}</span>
          </button>
          <button className={`pchip${!hasDate ? ' hidden' : ''}${hasTime ? ' on' : ''}`} onClick={() => onOpenDlg('dlgTime')}>
            <Clock />Time
            <span className="pchip-sum">{hasTime ? scheduled!.time : ''}</span>
          </button>
          <button className={`pchip${!hasDate ? ' hidden' : ''}${duration ? ' on' : ''}`} onClick={() => onOpenDlg('dlgDur')}>
            <Timer />Duration
            <span className="pchip-sum">{duration}</span>
          </button>
          <button className={priorityChipClass} onClick={() => onOpenDlg('dlgPriority')}>
            <Flag />Priority
            <span className="pchip-sum">{priority ? PRIORITY_LABELS[priority] : ''}</span>
          </button>
          <button className={`pchip${!showRepeat ? ' hidden' : ''}${repeat ? ' on' : ''}`} onClick={onOpenRepeatDlg}>
            <Repeat />Repeat
            <span className="pchip-sum">{repeat ? (repeat.type === 'after_completion' ? 'after ✓' : repeat.type || '') : ''}</span>
          </button>
        </div>

        <div className="entry-tags">
          {tags.map((t, i) => (
            <span key={i} className="etag">{t}</span>
          ))}
          <span className="etag etag-add" onClick={() => {
            const t = prompt('Tag:')
            if (t) onChange(prev => ({ ...prev, tags: [...prev.tags, t.trim()] }))
          }}>
            <Plus /> tag
          </span>
        </div>

        <div className="entry-divider"></div>

        <div
          key={bodyKey}
          ref={bodyRef}
          className="entry-body"
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          dangerouslySetInnerHTML={{ __html: bodyHtml }}
        />

      </div></div>
    </>
  )
}
