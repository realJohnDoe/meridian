import { useState, useMemo, useRef, useEffect } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { expandRange } from '../recurrence'
import { addDays, fmtShort, NOTES_DATA } from '../meridian'
import { cn } from '../lib/utils'

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)

interface SearchItem {
  title: string
  preview: string
  date: string
  tags: string[]
  type: string
  _node?: any
}

interface Props {
  onOpen: (item: any, scope?: string) => void
  onClose: () => void
}

export default function SearchView({ onOpen, onClose }: Props) {
  const nodes       = useStore(s => s.nodes)
  const nsFilterVal = useStore(s => s.nsFilterVal)
  const setNsFilter = useStore(s => s.setNsFilterVal)
  const [q, setQ]   = useState('')
  const inputRef    = useRef<HTMLInputElement>(null)

  useEffect(() => {
    ;(window as any)._focusSearch = () => setTimeout(() => inputRef.current?.focus(), 100)
    return () => { delete (window as any)._focusSearch }
  }, [])

  const items = useMemo<SearchItem[]>(() => {
    const from = addDays(TODAY, -30)
    const to   = addDays(TODAY, 90)
    const occs = expandRange(nodes, from, to) as Occurrence[]
    const seen = new Set<string>()
    return [
      ...(NOTES_DATA as SearchItem[]),
      ...occs
        .filter(o => {
          const key = o._nodeId || o.title
          if (seen.has(key)) return false
          seen.add(key); return true
        })
        .map(o => ({
          title:   o.title,
          preview: o.body || '',
          date:    fmtShort(o.jsTime),
          tags:    o.tags || [],
          type:    o.type,
          _node:   o._node || o,
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
    { label: 'All',    value: 'all'   },
    { label: 'Events', value: 'event' },
    { label: 'Tasks',  value: 'task'  },
    { label: 'Notes',  value: 'note'  },
  ]

  return (
    <>
      {/* Header — shared style with EntryEditor */}
      <div className="h-[var(--th)] flex items-center gap-2 px-3 border-b border-bdr shrink-0 bg-bg1">
        <button
          className="size-[34px] rounded-full flex items-center justify-center text-t2 transition-colors hover:bg-bg3 hover:text-t0 shrink-0"
          onClick={onClose}
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>
        <span className="flex-1 font-mono text-[11px] text-t3 overflow-hidden text-ellipsis whitespace-nowrap">Search</span>
      </div>

      {/* Search input */}
      <div className="flex items-center gap-[9px] bg-bg2 border border-bdr2 rounded-[10px] px-[13px] py-[9px] m-3">
        <Search size={16} className="stroke-t3 fill-none shrink-0" strokeWidth={2} />
        <input
          id="nsIn"
          ref={inputRef}
          type="text"
          placeholder="Search notes, tasks, events…"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="flex-1 bg-transparent border-0 outline-none text-t0 text-[14px] placeholder:text-t3"
        />
      </div>

      {/* Type filter chips */}
      <div className="flex gap-[5px] px-3 pb-[10px] overflow-x-auto [scrollbar-width:none]">
        {chips.map(c => (
          <button
            key={c.value}
            className={cn(
              'px-3 py-[5px] rounded-[20px] text-[12px] font-medium border cursor-pointer whitespace-nowrap transition-all duration-[120ms] shrink-0',
              nsFilterVal === c.value
                ? 'bg-ab2 text-ind border-ind'
                : 'bg-bg3 text-t2 border-bdr2',
            )}
            onClick={() => setNsFilter(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        <div className="pb-[80px]" id="nsList">
          {filtered.length === 0 ? (
            <div className="py-10 px-3.5 text-center text-t3 text-[13px]">No results</div>
          ) : (
            groups.map(g => (
              <div key={g.label}>
                {g.label && (
                  <div className="px-3.5 pt-[10px] pb-[3px] text-[10px] font-bold tracking-[.08em] uppercase text-t3">
                    {g.label}
                  </div>
                )}
                {g.items.map((it, i) => (
                  <div
                    key={i}
                    className="px-3.5 py-3 cursor-pointer transition-colors border-b border-bdr hover:bg-bg2"
                    onClick={() => onOpen(it._node ?? it)}
                  >
                    <div className="text-[14px] font-medium text-t0 mb-[3px]">{it.title}</div>
                    <div className="text-[12px] text-t3 leading-[1.5] line-clamp-2">{it.preview || ''}</div>
                    <div className="flex gap-[5px] mt-1 items-center">
                      <span className="text-[11px] text-t3 font-mono">{it.date}</span>
                      {it.tags.slice(0, 2).map(tg => (
                        <span key={tg} className="text-[10px] px-1.5 py-px rounded-[8px] bg-bg3 text-t3">{tg}</span>
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
