import { useLayoutEffect, useRef, useState } from 'react'
import { MOTION_MS, MOTION_EASE } from './motion'

interface Props {
  /**
   * Identifies the page currently shown — e.g. a `YYYY-MM` month key.
   * Compared as a string against the previous value to pick a direction: a
   * larger key slides the outgoing page out to the left (paging forward) and
   * the incoming page in from the right; a smaller key slides the other way.
   * Content changing without the key changing (e.g. a highlighted day
   * updating within the same month) swaps in place, unanimated.
   */
  slideKey: string
  children: React.ReactNode
}

interface Outgoing {
  key: string
  node: React.ReactNode
  forward: boolean
}

/**
 * Wraps paged content — a month grid, at both call sites today — so a page
 * change slides the old page out and the new one in, rather than swapping
 * instantly. Content already animated by a real drag gesture (see
 * useCarousel/MiniMonth's swipe carousel) has no use for this: it's for the
 * button/keyboard-driven paging controls that otherwise jump straight to the
 * new page.
 *
 * Follows FlipList's own choice of the Web Animations API over a toggled CSS
 * transition — `animate()` states the from/to explicitly, so there's no
 * disable-reflow-reenable dance whose timing is engine-specific.
 */
export function SlideTransition({ slideKey, children }: Props) {
  const [current, setCurrent] = useState({ key: slideKey, node: children })
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null)
  const currentRef = useRef<HTMLDivElement>(null)
  const outgoingRef = useRef<HTMLDivElement>(null)

  // Adjusting state during render (rather than in an effect) so the slide's
  // very first frame — outgoing at 0 / incoming off-screen — is already
  // correct in the commit React paints, with no jump-then-animate flash.
  if (current.key !== slideKey) {
    setOutgoing({ key: current.key, node: current.node, forward: slideKey > current.key })
    setCurrent({ key: slideKey, node: children })
  } else if (current.node !== children) {
    setCurrent({ key: slideKey, node: children })
  }

  useLayoutEffect(() => {
    if (!outgoing) return
    const cur = currentRef.current
    const out = outgoingRef.current
    if (!cur || !out) { setOutgoing(null); return }

    const sign = outgoing.forward ? -1 : 1
    const outAnim = out.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(${sign * 100}%)` }],
      { duration: MOTION_MS, easing: MOTION_EASE },
    )
    const inAnim = cur.animate(
      [{ transform: `translateX(${-sign * 100}%)` }, { transform: 'translateX(0)' }],
      { duration: MOTION_MS, easing: MOTION_EASE },
    )

    let live = true
    inAnim.finished.then(() => { if (live) setOutgoing(null) }).catch(() => {})
    return () => {
      live = false
      outAnim.cancel()
      inAnim.cancel()
    }
  }, [outgoing])

  return (
    <div className="relative overflow-hidden">
      {outgoing && (
        <div ref={outgoingRef} className="absolute inset-0" aria-hidden inert>
          {outgoing.node}
        </div>
      )}
      <div ref={currentRef}>{current.node}</div>
    </div>
  )
}
