import { useState, useMemo, useRef, useEffect } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { occKind } from '../types'
import { expandRange } from '../model/expansion'
import { addDays, fmtShort, NOTES_DATA } from '../meridian'
import { Badge, badgeVariants } from './ui/badge'

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)

interface SearchItem {
  title: string
  preview: string
  date: string
  tags: string[]
  type: string
  occurrence: Occurrence
}

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onOpen: (item: any, scope?: string) => void
  onClose: () => void
}

export default function SearchView({ onOpen, onClose }: Props) {
  const items        = useStore(s => s.items)
  const nsFilterVal  = useStore(s => s.nsFilterVal)
  const setNsFilter  = useStore(s => s.setNsFilterVal)
  const [q, setQ]    = useState('')
  const inputRef     = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any)._focusSearch = () => setTimeout(() => inputRef.current?.focus(), 100)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return () => { delete (window as any)._focusSearch }
  }, [])

  const items = useMemo<SearchItem[]>(() => {
    const from = addDays(TODAY, -30)
    const to   = addDays(TODAY, 90)
    const occs: Occurrence[] = expandRange(items, from, to)
    const seen = new Set<string>()
    return [
      ...(NOTES_DATA as SearchItem[]),
      ...occs
        .filter(o => {
          const key = o.fileSlug || o.metadata.title
          if (seen.has(key)) return false
          seen.add(key); return true
        })
        .map(o => ({
          title:      o.metadata.title,
          preview:    o.metadata.body || '',
          date:       o.metadata.jsTime ? fmtShort(o.metadata.jsTime) : o.date,
          tags:       o.metadata.tags || [],
          type:       occKind(o),
          occurrence: o,
        })),
    ]
  }, [nodes])

  const filtered = useMemo(() => {
    const ql = q.toLowerCase()
    return items.filter(it => {
      if (nsFilterVal !== 'all' && it.type !== nsFilterVal) return false
      if (ql && !it.title.toLowerCase().includes(ql)
             && !it.preview.toLowerCase().includes(ql)
             && !it.tags.some(t => t.includes(ql))) return false
      return true
    })
  }, [items, nsFilterVal, q])

  const groups: { label: string; items: SearchItem[] }[] = useMemo(() => {
    if (nsFilterVal !== 'all') return [{ label: '', items: filtered }]
    const byType: Record<string, SearchItem[]> = { event: [], task: [], note: [] }
    filtered.forEach(it => { if (byType[it.type]) byType[it.type].push(it) })
    return (['event', 'task', 'note'] as const)
      .filter(t => byType[t].length > 0)
      .map(t => ({ label: t === 'event' ? 'Events' : t === 'task' ? 'Tasks' : 'Notes', items: byType[t] }))
  }, [filtered, nsFilterVal])

  const chips: { label: string; value: string }[] = [
    { label: 'All',    value: 'all' },
    { label: 'Events', value: 'event' },
    { label: 'Tasks',  value: 'task' },
    { label: 'Notes',  value: 'note' },
  ]

  return (
    <>
      <div className="entry-top">
        <button className="ib" onClick={onClose}><ArrowLeft /></button>
        <span className="entry-fname">Search</span>
      </div>

      <div className="ns-bar">
        <Search size={16} />
        <input
          id="nsIn"
          ref={inputRef}
          type="text"
          placeholder="Search notes, tasks, events…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
      </div>

      <div className="ns-filters">
        {chips.map(c => (
          <button
            key={c.value}
            className={badgeVariants({ variant: 'chip' })}
            aria-pressed={nsFilterVal === c.value}
            onClick={() => setNsFilter(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="ns-sc">
        <div className="ns-pad" id="nsList">
          {filtered.length === 0 ? (
            <div className="empty-state">No results</div>
          ) : (
            groups.map(g => (
              <div key={g.label}>
                {g.label && <div className="ns-sec">{g.label}</div>}
                {g.items.map((it, i) => (
                  <div key={i} className="note-row" onClick={() => onOpen(it.occurrence ?? it)}>
                    <div className="nr-t">{it.title}</div>
                    <div className="nr-p">{it.preview || ''}</div>
                    <div className="nr-m">
                      <span className="nr-d">{it.date}</span>
                      {it.tags.slice(0, 2).map(tg => (
                        <Badge key={tg} variant="tag">{tg}</Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  )
}
