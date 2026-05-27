import { useRef, useEffect, useState } from 'react'
import { Check, Repeat2, Trash2 } from 'lucide-react'
import type { Occurrence } from '../types'
import { fmtT } from '../recurrence'
import { barClass } from '../meridian'
import { cn } from '../lib/utils'

interface Props {
  occ: Occurrence
  index: number
  onOpen: () => void
  onToggleDone: () => void
  onSwipeDelete: () => (() => void)
}

export default function OccurrenceRow({ occ, index, onOpen, onToggleDone, onSwipeDelete }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const [isDone, setIsDone] = useState(!!occ.done)
  const staggerRef = useRef(index)

  const onSwipeDeleteRef = useRef(onSwipeDelete)
  useEffect(() => { onSwipeDeleteRef.current = onSwipeDelete }, [onSwipeDelete])

  useEffect(() => { setIsDone(!!occ.done) }, [occ.done])

  const t = fmtT(occ.time)
  const hasTrack = occ.done !== undefined

  // Swipe-to-delete: raw addEventListener with passive:false to call preventDefault.
  useEffect(() => {
    if (!wrapRef.current || !rowRef.current || !hintRef.current) return
    const wrap  = wrapRef.current  as HTMLDivElement
    const row   = rowRef.current   as HTMLDivElement
    const hintL = hintRef.current  as HTMLDivElement

    const THRESHOLD = 72
    const FULL_FRAC = 0.5
    let sx = 0, sy = 0, tracking = false, blocked = false

    function onTouchStart(e: TouchEvent) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY
      tracking = false; blocked = false
      row.style.animation = 'none'; row.style.transition = 'none'
    }

    function onTouchMove(e: TouchEvent) {
      const dx = e.touches[0].clientX - sx
      const dy = e.touches[0].clientY - sy
      if (!tracking) {
        if (Math.abs(dy) > Math.abs(dx)) { blocked = true; return }
        if (dx > 0) { blocked = true; return }
        tracking = true
      }
      if (blocked) return
      e.preventDefault()
      const rowW = wrap.offsetWidth || 320
      const absDx = Math.abs(dx)
      const clamped = Math.max(dx, -rowW)
      row.style.transform = `translateX(${clamped}px)`
      if (dx < -8) {
        hintL.style.display = 'flex'
        const fullPx = rowW * FULL_FRAC
        const prog = Math.min(absDx / fullPx, 1)
        const isFullReady = absDx >= fullPx
        hintL.style.filter = `saturate(${0.3 + prog * 0.7})`
        hintL.style.opacity = String(0.4 + prog * 0.6)
        const iconEl = hintL.querySelector('svg')
        if (iconEl) (iconEl as SVGElement).style.transform = isFullReady ? 'scale(1.3)' : `scale(${0.7 + prog * 0.3})`
      } else {
        hintL.style.display = 'none'
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (blocked || !tracking) {
        row.style.transition = ''; row.style.transform = ''
        hintL.style.display = 'none'; return
      }
      const dx = e.changedTouches[0].clientX - sx
      const rowW = wrap.offsetWidth || 320
      const isFull = Math.abs(dx) / rowW >= FULL_FRAC
      hintL.style.display = ''; hintL.style.filter = ''; hintL.style.opacity = ''
      if (dx <= -THRESHOLD && isFull) {
        const applyDelete = onSwipeDeleteRef.current()
        wrap.style.height = wrap.offsetHeight + 'px'; wrap.style.overflow = 'hidden'
        void wrap.offsetHeight
        row.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1)'
        row.style.transform = `translateX(-${rowW}px)`
        wrap.style.transition = 'height .22s ease, opacity .22s ease'
        wrap.style.height = '0'; wrap.style.opacity = '0'
        setTimeout(() => applyDelete(), 230)
      } else {
        row.style.transition = 'transform .28s cubic-bezier(.4,0,.2,1)'
        row.style.transform = ''
      }
    }

    row.addEventListener('touchstart', onTouchStart, { passive: true })
    row.addEventListener('touchmove', onTouchMove, { passive: false })
    row.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      row.removeEventListener('touchstart', onTouchStart)
      row.removeEventListener('touchmove', onTouchMove)
      row.removeEventListener('touchend', onTouchEnd)
    }
  }, [])

  function handleCheckClick(e: React.MouseEvent) {
    e.stopPropagation()
    setIsDone(prev => !prev)
    onToggleDone()
  }

  const effectiveDone = hasTrack ? isDone : (occ.done as boolean | undefined)
  const currentBarClass = barClass({ ...occ, done: effectiveDone })

  return (
    <div
      className="swipe-wrap"
      ref={wrapRef}
      data-occ-key={`${occ._nodeId}-${occ.date}`}
      style={{ '--stagger': `${staggerRef.current * 0.025}s` } as React.CSSProperties}
    >
      {/* Left swipe hint — swipe-hint CSS stays in index.css */}
      <div className="swipe-hint left" ref={hintRef} style={{ display: 'none' }}>
        <Trash2 size={18} />
        <span>Delete</span>
      </div>

      {/* Main row — swipe-row + occ-row CSS stays in index.css */}
      <div
        className={cn('swipe-row occ-row', isDone && 'opacity-50')}
        ref={rowRef}
        onClick={e => { if (!(e.target as HTMLElement).closest('.occ-chk')) onOpen() }}
      >
        {/* Time column */}
        <div className="w-12 shrink-0 flex flex-col items-end gap-px pt-[3px]">
          <span className={cn('text-[11px] font-mono tracking-[.02em] leading-[1.2]', t ? 'text-cyn' : 'text-t3')}>
            {t || ''}
          </span>
          {occ.duration && t && (
            <span className="text-[9px] font-mono text-t3 opacity-75">{occ.duration}</span>
          )}
        </div>

        {/* State bar — .occ-bar variants stay in index.css */}
        <span className={`occ-bar ${currentBarClass}`} />

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {hasTrack && (
              <div
                className={cn(
                  'size-5 rounded-full border-[1.5px] border-bg4 flex items-center justify-center shrink-0 mt-px transition-colors',
                  isDone && 'bg-grn border-grn',
                )}
                onClick={handleCheckClick}
              >
                <Check size={10} className={cn('stroke-white fill-none', isDone ? 'opacity-100' : 'opacity-0')} strokeWidth={2.5} />
              </div>
            )}
            <span className={cn('text-[14px] font-medium text-t0 truncate flex-1', isDone && 'line-through text-t3')}>
              {occ.title}
            </span>
            {occ.recur && (
              <span className="inline-flex items-center ml-1 opacity-45 shrink-0 align-middle">
                <Repeat2 size={11} />
              </span>
            )}
          </div>

          {(occ.tags || []).length > 0 && (
            <div className="flex items-center gap-[5px] mt-0.5 flex-wrap">
              {(occ.tags || []).slice(0, 2).map(tg => (
                <span
                  key={tg}
                  className={cn(
                    'text-[10px] px-1.5 py-px rounded-[8px]',
                    occ.type === 'event' ? 'bg-ab text-ind' : 'bg-bg3 text-t3',
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
}
