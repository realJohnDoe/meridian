import { useRef, useEffect } from 'react'

export interface Scheduled { date: string; time: string }

export interface EntryState {
  item: any
  title: string
  bodyHtml: string
  scheduled: Scheduled | null
  duration: string
  tracked: boolean
  repeat: any
  done: boolean
  tags: string[]
  priority: string | null
  editScope: string
}

export const ENTRY_DEFAULT: EntryState = {
  item: null,
  title: '',
  bodyHtml: '',
  scheduled: null,
  duration: '',
  tracked: true,
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
}

export default function EntryEditor({ entry, onChange, onSave, onDelete, onClose, onOpenDlg, onOpenRepeatDlg }: Props) {
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (titleRef.current) autoResize(titleRef.current)
  }, [entry.title])

  useEffect(() => {
    if (typeof (window as any).lucide !== 'undefined') {
      (window as any).lucide.createIcons()
    }
  })

  const { item, title, bodyHtml, scheduled, duration, tracked, repeat, done, tags, priority, editScope } = entry

  const isRecur = !!(item && (item.recur || item._node?.repeat || item.repeat))
  const fname = item
    ? ((item._node?.id || item._nodeId || item.id || item.title || 'untitled') + '.md').toLowerCase().replace(/\s+/g, '-')
    : 'untitled.md'

  const hasDate = !!scheduled
  const hasTime = !!(scheduled?.time)
  const isSingleScope = editScope === 'single'
  const showRepeat = (hasDate || tracked) && !isSingleScope
  const priorityChipClass = ['pchip', !tracked ? 'hidden' : '', priority ? 'on' : '', priority ? PRIORITY_CLASS[priority] : ''].filter(Boolean).join(' ')
  const bodyKey = item ? `${item._nodeId || item.id || 'item'}-${item.date || ''}-${editScope}` : 'new'

  return (
    <>
      <div className="entry-top">
        <button className="ib" onClick={onClose}><i data-lucide="arrow-left"></i></button>
        <span className="entry-fname">{fname}</span>
        {item && (
          <button className="ib" onClick={onDelete} title="Delete" style={{ color: 'var(--ros)' }}>
            <i data-lucide="trash-2"></i>
          </button>
        )}
        <button className="save-btn" onClick={() => onSave(bodyRef.current?.innerText?.trim() ?? '')}>Save</button>
      </div>

      <div className="entry-sc"><div className="entry-pad">

        <div className="entry-title-row">
          <div
            className={['echk', tracked ? 'show' : '', done ? 'on' : ''].filter(Boolean).join(' ')}
            onClick={() => onChange(prev => ({ ...prev, done: !prev.done }))}
          >
            <i data-lucide="check"></i>
          </div>
          <textarea
            ref={titleRef}
            className="entry-title-in"
            placeholder="Title"
            rows={1}
            value={title}
            onChange={e => { onChange(prev => ({ ...prev, title: e.target.value })); autoResize(e.target) }}
          />
        </div>

        {isRecur && (
          <div className="scope-row">
            <span className="scope-lbl">Edit</span>
            <select className="scope-select" value={editScope} onChange={e => onChange(prev => ({ ...prev, editScope: e.target.value }))}>
              <option value="single">This event</option>
              <option value="future">This and following events</option>
              <option value="all">All events</option>
            </select>
          </div>
        )}

        <div className="prop-chips">
          <button className={`pchip${scheduled ? ' on' : ''}`} onClick={() => onOpenDlg('dlgSched')}>
            <i data-lucide="calendar"></i>Date
            <span className="pchip-sum">{scheduled ? scheduled.date.slice(5).replace('-', '/') : ''}</span>
          </button>
          <button className={`pchip${!hasDate ? ' hidden' : ''}${hasTime ? ' on' : ''}`} onClick={() => onOpenDlg('dlgTime')}>
            <i data-lucide="clock"></i>Time
            <span className="pchip-sum">{hasTime ? scheduled!.time : ''}</span>
          </button>
          <button className={`pchip${!hasDate ? ' hidden' : ''}${duration ? ' on' : ''}`} onClick={() => onOpenDlg('dlgDur')}>
            <i data-lucide="timer"></i>Duration
            <span className="pchip-sum">{duration}</span>
          </button>
          <button className={`pchip${tracked ? ' on tc' : ''}`} onClick={() => onChange(prev => ({ ...prev, tracked: !prev.tracked, priority: prev.tracked ? null : prev.priority }))}>
            <i data-lucide="circle-check"></i>Track Completion
          </button>
          <button className={priorityChipClass} onClick={() => onOpenDlg('dlgPriority')}>
            <i data-lucide="flag"></i>Priority
            <span className="pchip-sum">{priority ? PRIORITY_LABELS[priority] : ''}</span>
          </button>
          <button className={`pchip${!showRepeat ? ' hidden' : ''}${repeat ? ' on' : ''}`} onClick={onOpenRepeatDlg}>
            <i data-lucide="repeat"></i>Repeat
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
            <i data-lucide="plus"></i> tag
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
