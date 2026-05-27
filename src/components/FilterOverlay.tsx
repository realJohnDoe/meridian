import { useMemo } from 'react'
import { Plus, Check, Repeat2 } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { expandRange, fmtT } from '../recurrence'
import { addDays, fmtShort, barClass } from '../meridian'
import { cn } from '../lib/utils'

const TODAY = new Date(); TODAY.setHours(0, 0, 0, 0)

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true
  const q = query.toLowerCase(), t = text.toLowerCase()
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++
  return qi === q.length
}

function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase()
  let score = 0, qi = 0, cons = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { qi++; cons++; score += cons } else { cons = 0 }
  }
  if (t.startsWith(q)) score += 100
  return score
}

interface Props {
  query: string
  onOpen: (occ: Occurrence) => void
  onCreate: (title: string) => void
}

export default function FilterOverlay({ query, onOpen, onCreate }: Props) {
  const nodes = useStore(s => s.nodes)

  const results = useMemo(() => {
    if (!query) return []
    const from = addDays(TODAY, -7)
    const to   = addDays(TODAY, 90)
    const occs = expandRange(nodes, from, to) as Occurrence[]
    return occs
      .filter(o => fuzzyMatch(query, o.title))
      .map(o => ({ occ: o, score: fuzzyScore(query, o.title) }))
      .sort((a, b) => b.score - a.score || +a.occ.jsTime - +b.occ.jsTime)
      .map(x => x.occ)
  }, [nodes, query])

  if (!query) return null

  return (
    <div
      id="filterOverlay"
      className="absolute top-[var(--th)] bottom-0 left-0 right-0 bg-bg1 z-[45] overflow-y-auto pb-[80px]"
    >
      {/* Create row */}
      <div
        className="flex items-center gap-[10px] px-3.5 py-3 cursor-pointer border-b border-bdr transition-colors hover:bg-bg2 text-ind"
        onClick={() => onCreate(query)}
      >
        <Plus size={14} />
        <span>Create "<strong className="font-semibold">{query}</strong>"</span>
      </div>

      {results.length === 0 && (
        <div className="py-10 px-3.5 text-center text-t3 text-[13px]">No matches</div>
      )}

      {results.map((o, i) => {
        const t = fmtT(o.time)
        const hasTrack = o.done !== undefined
        const isDone = !!o.done

        return (
          <div
            key={`${o._nodeId}-${o.date}`}
            className="swipe-wrap"
            style={{ animation: 'fadeUp .16s ease both', animationDelay: `${i * 0.025}s` }}
          >
            <div
              className={cn('swipe-row occ-row', isDone && 'opacity-50')}
              onClick={() => onOpen(o)}
            >
              <div className="w-12 shrink-0 flex flex-col items-end gap-px pt-[3px]">
                <span className={cn('text-[11px] font-mono tracking-[.02em] leading-[1.2]', t ? 'text-cyn' : 'text-t3')}>
                  {t || ''}
                </span>
              </div>

              <span className={`occ-bar ${barClass(o)}`} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {hasTrack && (
                    <div className={cn(
                      'size-5 rounded-full border-[1.5px] border-bg4 flex items-center justify-center shrink-0',
                      isDone && 'bg-grn border-grn',
                    )}>
                      <Check size={10} className={cn('stroke-white fill-none', isDone ? 'opacity-100' : 'opacity-0')} strokeWidth={2.5} />
                    </div>
                  )}
                  <span className={cn('text-[14px] font-medium text-t0 truncate flex-1', isDone && 'line-through text-t3')}>
                    {o.title}
                  </span>
                  {o.recur && <span className="inline-flex items-center ml-1 opacity-45 shrink-0"><Repeat2 size={11} /></span>}
                  <span className="opacity-50 text-[10px] ml-1">{fmtShort(o.jsTime)}</span>
                </div>
                {(o.tags || []).length > 0 && (
                  <div className="flex items-center gap-[5px] mt-0.5 flex-wrap">
                    {(o.tags || []).slice(0, 2).map(tg => (
                      <span
                        key={tg}
                        className={cn(
                          'text-[10px] px-1.5 py-px rounded-[8px]',
                          o.type === 'event' ? 'bg-ab text-ind' : 'bg-bg3 text-t3',
                        )}
                      >
                        {tg}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
