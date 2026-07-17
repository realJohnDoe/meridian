import { useRef, useLayoutEffect } from 'react'
import type React from 'react'

const DURATION = 350
const EASING   = 'cubic-bezier(.4,0,.2,1)'

interface FlipOptions {
  /**
   * Also animate the container's own height to its new value, on the same
   * clock as the rows, so the section folds up around a leaving row instead
   * of snapping to its new height. Requires the container to be a block box
   * whose children are laid out by an inner wrapper — animating the height of
   * a flex column would let the flex algorithm squash the rows themselves.
   * Leave off for lists inside a virtualizer, which owns their height.
   */
  animateHeight?: boolean
}

/**
 * FLIP transition for rows identified by `[attr]` inside a container.
 * Whenever a row's position shifts between renders — because it moved within
 * the list, or because a sibling entered/left — it animates from its previous
 * position to its new one. The diff is purely per-key (no same-count
 * requirement), so removing or adding a row elsewhere in the container makes
 * the rest of the list glide into place instead of snapping.
 *
 * Uses the Web Animations API rather than toggling CSS transitions: driving a
 * transition from a layout effect means disabling it, forcing a reflow, then
 * re-enabling it a frame later, and whether that actually starts a transition
 * comes down to engine-specific style-flush timing (Firefox routinely drops
 * it). `animate()` states the from/to explicitly and has no such race.
 */
export function useFlipTransition<T>(
  containerRef: React.RefObject<HTMLElement | null>,
  items: T[],
  attr: string,
  { animateHeight = false }: FlipOptions = {},
) {
  const prevTops   = useRef<Record<string, number> | null>(null)
  const prevHeight = useRef<number | null>(null)
  const rowAnims   = useRef<Animation[]>([])
  const heightAnim = useRef<Animation | null>(null)

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

    const prev        = prevTops.current
    const keysChanged = prev === null || !sameKeys(prev, tops)
    const anyMoved    = prev !== null && measured.some(m =>
      prev[m.key] !== undefined && Math.abs(prev[m.key] - m.layout) > 1)

    // An unrelated re-render (a keystroke in a row, a store tick) commits the
    // same layout. Leave any in-flight animation alone rather than restarting
    // it from scratch, which would stretch a 350ms fold out indefinitely.
    if (!keysChanged && !anyMoved) return

    for (const a of rowAnims.current) a.cancel()
    rowAnims.current = []
    for (const { row, key, layout, ty } of measured) {
      const from = prev?.[key] === undefined ? 0 : prev[key] - layout + ty
      if (Math.abs(from) <= 1) continue
      rowAnims.current.push(row.animate(
        [{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }],
        { duration: DURATION, easing: EASING },
      ))
    }

    if (animateHeight) {
      // A running height animation pins the container, so its measured height
      // is the animated value: that's where the fold has to resume from, but
      // the natural target can only be read back once it's cancelled.
      const running = heightAnim.current
      const from    = running ? cRect.height : prevHeight.current
      running?.cancel()
      heightAnim.current = null
      const target = running ? container.getBoundingClientRect().height : cRect.height

      if ((keysChanged || running) && from !== null && Math.abs(from - target) > 1) {
        // Rows glide on the same duration and easing, so the bottom-most one
        // tracks the closing edge exactly and never gets cut off; clipping is
        // what turns the leaving row's fade into a fold.
        container.style.overflow = 'hidden'
        const anim = container.animate(
          [{ height: `${from}px` }, { height: `${target}px` }],
          { duration: DURATION, easing: EASING },
        )
        heightAnim.current = anim
        void anim.finished.then(
          () => {
            if (heightAnim.current !== anim) return
            heightAnim.current = null
            container.style.overflow = ''
          },
          () => {/* cancelled — whichever run cancelled it owns the cleanup */},
        )
      } else {
        container.style.overflow = ''
      }
      prevHeight.current = target
    }

    prevTops.current = tops
  }, [items, containerRef, attr, animateHeight])
}

function translateY(el: HTMLElement): number {
  const t = getComputedStyle(el).transform
  return t === 'none' ? 0 : new DOMMatrixReadOnly(t).m42
}

function sameKeys(a: Record<string, number>, b: Record<string, number>): boolean {
  const ak = Object.keys(a)
  return ak.length === Object.keys(b).length && ak.every(k => k in b)
}

export interface FlipLeaveRect {
  top: number
  left: number
  width: number
}

/**
 * Measures `rowEl` relative to `containerRef`'s current box, for rendering a
 * row that's about to leave the list as an absolutely-positioned overlay.
 * Pulling the leaving row out of flow this way — instead of shrinking it in
 * place — means the container's layout settles immediately, so the
 * `useFlipTransition` pass on the surviving rows sees one clean before/after
 * diff and glides them into place while the overlay fades out on top.
 */
export function captureFlipLeaveRect(
  containerRef: React.RefObject<HTMLElement | null>,
  rowEl: HTMLElement,
): FlipLeaveRect | null {
  const container = containerRef.current
  if (!container) return null
  const c = container.getBoundingClientRect()
  const r = rowEl.getBoundingClientRect()
  return { top: r.top - c.top, left: r.left - c.left, width: r.width }
}
