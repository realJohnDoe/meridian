import { useMemo } from 'react'
import { Plus, Check, Repeat2 } from 'lucide-react'
import { useStore } from '../store'
import type { Occurrence } from '../types'
import { expandRange, fmtT } from '../recurrence'
import { addDays, fmtShort, barClass } from '../meridian'

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
    <div id="filterOverlay" className="filter-overlay">
      {/* "Create" row */}
      <div className="occ-create-row" onClick={() => onCreate(query)}>
        <Plus size={14} />
        <span>Create "<strong>{query}</strong>"</span>
      </div>

      {results.length === 0 && (
        <div style={{ padding: '40px 14px', textAlign: 'center', color: 'var(--t3)', fontSize: 13 }}>
          No matches
        </div>
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
              className={`swipe-row occ-row${isDone ? ' is-done' : ''}`}
              onClick={() => onOpen(o)}
            >
              <div className="occ-left">
                <span className={`occ-time${t ? ' timed' : ''}`}>{t || ''}</span>
              </div>
              <span className={`occ-bar ${barClass(o)}`} />
              <div className="occ-body">
                <div className="occ-tr">
                  {hasTrack && (
                    <div className={`occ-chk${isDone ? ' done' : ''}`} style={{ flexShrink: 0 }}>
                      <Check size={14} />
                    </div>
                  )}
                  <span className={`occ-title${isDone ? ' done-t' : ''}`}>{o.title}</span>
                  {o.recur && <span className="orecur"><Repeat2 size={12} /></span>}
                  <span style={{ opacity: 0.5, fontSize: 10, marginLeft: 4 }}>{fmtShort(o.jsTime)}</span>
                </div>
                {(o.tags || []).length > 0 && (
                  <div className="occ-meta">
                    {(o.tags || []).slice(0, 2).map(tg => (
                      <span key={tg} className={`otag${o.type === 'event' ? ' ev' : ''}`}>{tg}</span>
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
