import { useRef, useEffect, useState } from 'react'
import { Check, Repeat2, Trash2 } from 'lucide-react'
import type { Occurrence } from '../types'
import { fmtT } from '../model/expand'
import { barClass } from '../meridian'

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
  // Lock the stagger delay at first mount so reordering never restarts the entry animation.
  const staggerRef = useRef(index)

  // Keep a stable ref to the callback so the touch-listener closure never goes stale.
  const onSwipeDeleteRef = useRef(onSwipeDelete)
  useEffect(() => { onSwipeDeleteRef.current = onSwipeDelete }, [onSwipeDelete])

  // Sync optimistic state when the store settles.
  useEffect(() => { setIsDone(!!occ.done) }, [occ.done])

  const t = fmtT(occ.time)
  const hasTrack = occ.done !== undefined

  // Swipe-to-delete: touchmove must call preventDefault() to block scroll while
  // the user is swiping horizontally. JSX onTouchMove cannot do that (passive by
  // default in modern browsers), so we use raw addEventListener with passive:false.
  useEffect(() => {
    // Guard: should never be null when mounted, but required for type safety.
    if (!wrapRef.current || !rowRef.current || !hintRef.current) return
    // Non-null assertions: narrowing doesn't carry into nested closure functions,
    // so we re-bind as non-nullable types here.
    const wrap = wrapRef.current as HTMLDivElement
    const row  = rowRef.current  as HTMLDivElement
    const hintL = hintRef.current as HTMLDivElement

    const THRESHOLD = 72
    const FULL_FRAC = 0.5
    let sx = 0, sy = 0, tracking = false, blocked = false

    function onTouchStart(e: TouchEvent) {
      sx = e.touches[0].clientX
      sy = e.touches[0].clientY
      tracking = false
      blocked = false
      row.style.animation = 'none'
      row.style.transition = 'none'
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
        row.style.transition = ''
        row.style.transform = ''
        hintL.style.display = 'none'
        return
      }
      const dx = e.changedTouches[0].clientX - sx
      const rowW = wrap.offsetWidth || 320
      const isFull = Math.abs(dx) / rowW >= FULL_FRAC
      hintL.style.display = 'none'
      hintL.style.filter = ''
      hintL.style.opacity = ''
      if (dx <= -THRESHOLD && isFull) {
        // Phase 1: show toast immediately (before animation completes).
        // beginSwipeDelete() returns applyDelete — the function that actually
        // removes the item from the store once the exit animation is done.
        const applyDelete = onSwipeDeleteRef.current()
        // Kick off slide + collapse simultaneously.
        wrap.style.height = wrap.offsetHeight + 'px'
        wrap.style.overflow = 'hidden'
        void wrap.offsetHeight  // force reflow so the fixed height is registered
        row.style.transition = 'transform .22s cubic-bezier(.4,0,.2,1)'
        row.style.transform = `translateX(-${rowW}px)`
        wrap.style.transition = 'height .22s ease, opacity .22s ease'
        wrap.style.height = '0'
        wrap.style.opacity = '0'
        // Phase 2: remove from store after animation so React unmounts cleanly.
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
  }, []) // listeners are stable; callback accessed via ref

  function handleCheckClick(e: React.MouseEvent) {
    e.stopPropagation()
    setIsDone(prev => !prev) // optimistic — store will confirm via occ.done effect
    onToggleDone()
  }

  // Compute bar class with optimistic done value so the colour changes instantly.
  const effectiveDone = hasTrack ? isDone : (occ.done as boolean | undefined)
  const currentBarClass = barClass({ ...occ, done: effectiveDone })

  return (
    <div
      className="swipe-wrap"
      ref={wrapRef}
      data-occ-key={`${occ._nodeId}-${occ.date}`}
      style={{ '--stagger': `${staggerRef.current * 0.025}s` } as React.CSSProperties}
    >
      {/* Left swipe hint */}
      <div className="swipe-hint left" ref={hintRef} style={{ display: 'none' }}>
        <Trash2 size={18} />
        <span>Delete</span>
      </div>

      {/* Main row */}
      <div
        className={`swipe-row occ-row${isDone ? ' is-done' : ''}`}
        ref={rowRef}
        onClick={e => { if (!(e.target as HTMLElement).closest('.occ-chk')) onOpen() }}
      >
        <div className="occ-left">
          <span className={`occ-time${t ? ' timed' : ''}`}>{t || ''}</span>
          {occ.duration && t && <span className="occ-dur-small">{occ.duration}</span>}
        </div>

        <span className={`occ-bar ${currentBarClass}`} />

        <div className="occ-body">
          <div className="occ-tr">
            {hasTrack && (
              <div
                className={`occ-chk${isDone ? ' done' : ''}`}
                style={{ flexShrink: 0 }}
                onClick={handleCheckClick}
              >
                <Check size={14} />
              </div>
            )}
            <span className={`occ-title${isDone ? ' done-t' : ''}`}>{occ.title}</span>
            {occ.recur && <span className="orecur"><Repeat2 size={12} /></span>}
          </div>

          {(occ.tags || []).length > 0 && (
            <div className="occ-meta">
              {(occ.tags || []).slice(0, 2).map(tg => (
                <span key={tg} className={`otag${occ.type === 'event' ? ' ev' : ''}`}>{tg}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
