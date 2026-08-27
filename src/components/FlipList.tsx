import { useRef, useLayoutEffect } from 'react'
import type React from 'react'
import { MOTION_MS, MOTION_EASE } from './primitives/motion'

interface Props {
  /** The rows currently in the list — a new value is what triggers a re-measure. */
  items: readonly unknown[]
  /** Attribute identifying each row, e.g. `data-occ-key`. Values must be stable per row. */
  itemAttr: string
  /**
   * Hand the list's layout over to CSS for as long as a row is collapsing on
   * its way out (see CollapseRow). A collapse moves every later row
   * continuously, without a re-render per frame, so any commit landing
   * mid-collapse would measure rows in transit and glide them a second time —
   * from wherever the transition had got to, towards a target it is still
   * moving. Positions are still recorded while suspended, so the glide that
   * comes after starts from where CSS actually left things.
   */
  suspended?: boolean
  children: React.ReactNode
}

/**
 * Animates a list so rows glide between positions rather than jumping there.
 * Any row carrying `itemAttr` is tracked by that attribute's value, and moves
 * from wherever it was to wherever this render put it — whether it moved
 * within the list or a sibling entered or left around it.
 *
 * Scope note: this handles rows that *move* — a reorder, or a neighbour
 * entering or leaving. It deliberately does not animate the list box itself.
 * A row on its way out collapses in flow instead (CollapseRow), which shrinks
 * the box as a plain consequence of layout; see that file for why measuring
 * and animating the box's height directly was worth removing.
 */
export function FlipList(props: Props) {
  const { items, itemAttr, children } = props
  // Default via `??` in the body rather than as a destructured-parameter
  // default — that shape makes babel-plugin-react-compiler silently skip
  // memoizing this component. See OccurrenceCard.tsx for the full rationale.
  const suspended = props.suspended ?? false
  const ref = useRef<HTMLDivElement>(null)
  useFlipTransition(ref, items, itemAttr, suspended)
  return <div ref={ref} className="relative">{children}</div>
}

/**
 * Uses the Web Animations API rather than toggling CSS transitions: driving a
 * transition from a layout effect means disabling it, forcing a reflow, then
 * re-enabling it a frame later, and whether that actually starts a transition
 * comes down to engine-specific style-flush timing (Firefox routinely dropped
 * it). `animate()` states the from/to explicitly and has no such race.
 */
function useFlipTransition(
  containerRef: React.RefObject<HTMLElement | null>,
  items: readonly unknown[],
  attr: string,
  suspended: boolean,
) {
  const prevTopsRef  = useRef<Record<string, number> | null>(null)
  const rowAnimsRef  = useRef<Animation[]>([])
  const wasSuspendedRef = useRef(false)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    const rows  = [...container.querySelectorAll<HTMLElement>(`[${attr}]`)]
    const cRect = container.getBoundingClientRect()

    // READ: one batched pass — every measurement happens before any write, so
    // the whole batch costs a single reflow rather than one per row.
    // A row still mid-glide carries a transform, so subtract it to recover the
    // layout position React just committed; it's also the offset a replacement
    // glide has to start from to pick up exactly where this one left off.
    const measured = rows.map(row => {
      const ty = translateY(row)
      return {
        row,
        key:    row.getAttribute(attr)!,
        layout: row.getBoundingClientRect().top - cRect.top - ty,
        ty,
      }
    })

    const tops: Record<string, number> = {}
    for (const m of measured) tops[m.key] = m.layout

    // The commit that *ends* a suspension is settled CSS layout too, not a jump
    // to animate: it is the one where the collapsed row finally unmounts, and
    // every position it reports was put there by the transition that just
    // finished. Animating from the pre-collapse baseline here would replay the
    // whole collapse as a glide.
    const cssOwnsLayout = suspended || wasSuspendedRef.current
    wasSuspendedRef.current = suspended
    if (cssOwnsLayout) {
      prevTopsRef.current = tops
      return
    }

    const prev        = prevTopsRef.current
    const keysChanged = prev === null || !sameKeys(prev, tops)
    const anyMoved    = prev !== null && measured.some(m => {
      const prevTop = prev[m.key]
      return prevTop !== undefined && Math.abs(prevTop - m.layout) > 1
    })

    // An unrelated re-render (a keystroke in a row, a store tick) commits the
    // same layout. Leave any in-flight animation alone rather than restarting
    // it from scratch, which would stretch a 350ms glide out indefinitely.
    if (!keysChanged && !anyMoved) return

    for (const a of rowAnimsRef.current) a.cancel()
    rowAnimsRef.current = []
    for (const { row, key, layout, ty } of measured) {
      // A row with no prior top either just mounted the whole list (prev is
      // null — every key is "new" and none of them should animate) or is one
      // row genuinely entering an already-mounted list (a redo/reopen). The
      // latter has nothing to glide from: it lands at its full final layout
      // position the instant React commits it, in the same frame a sibling
      // that has to make room for it is still transform-held at its *old*
      // spot — which is exactly where the entrant now sits. Left alone, the
      // two render solidly on top of each other until the sibling's glide
      // catches up. Fading the entrant in (rather than leaving it opaque
      // with no animation at all) means that overlap is never opaque-on-opaque.
      if (prev !== null && prev[key] === undefined) {
        rowAnimsRef.current.push(row.animate(
          [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: MOTION_MS, easing: MOTION_EASE },
        ))
        continue
      }
      const from = prev?.[key] === undefined ? 0 : prev[key] - layout + ty
      if (Math.abs(from) <= 1) continue
      rowAnimsRef.current.push(row.animate(
        [{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }],
        { duration: MOTION_MS, easing: MOTION_EASE },
      ))
    }

    prevTopsRef.current = tops
  }, [items, containerRef, attr, suspended])
}

function translateY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m42
}

function sameKeys(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a)
  return ak.length === Object.keys(b).length && ak.every(k => k in b)
}
