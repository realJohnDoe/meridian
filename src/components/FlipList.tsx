import { useRef, useLayoutEffect } from 'react'
import type React from 'react'
import { findScrollParent } from '@/lib/scrollParent'

const DURATION = 350
const EASING   = 'cubic-bezier(.4,0,.2,1)'

interface Props {
  /** The rows currently in the list — a new value is what triggers a re-measure. */
  items: readonly unknown[]
  /** Attribute identifying each row, e.g. `data-occ-key`. Values must be stable per row. */
  itemAttr: string
  /**
   * Fold the list to its new height, on the same clock as the rows, whenever
   * one enters or leaves — otherwise the rows glide but the list snaps.
   * Don't turn this on inside a virtualizer: it measures the list itself and
   * would fight an animated height, one resize notification per frame.
   */
  animateHeight?: boolean
  /** Only when the caller needs to measure against the box — see captureFlipLeaveRect. */
  containerRef?: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
}

/**
 * Animates a list so rows glide between positions rather than jumping there.
 * Any row carrying `itemAttr` is tracked by that attribute's value, and moves
 * from wherever it was to wherever this render put it — whether it moved
 * within the list or a sibling entered or left around it.
 *
 * Renders a plain block box and deliberately does not lay the rows out
 * itself: whatever arranges them (a flex column, a `<ul>`, …) goes inside as
 * a child. That split is what `animateHeight` rests on — pinning a *flex*
 * container to a height below its content makes the flex algorithm squash the
 * rows, where a block box clips them, which is the fold we're after.
 *
 * `animateHeight` takes its default via `??` in the body rather than as a
 * destructured-parameter default — that shape makes
 * babel-plugin-react-compiler silently skip memoizing this component. See
 * OccurrenceCard.tsx for the full rationale.
 */
export function FlipList(props: Props) {
  const { items, itemAttr, containerRef, children } = props
  const animateHeight = props.animateHeight ?? false
  const ownRef = useRef<HTMLDivElement>(null)
  const ref = containerRef ?? ownRef
  useFlipTransition(ref, items, itemAttr, animateHeight)
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
  animateHeight: boolean,
) {
  const prevTopsRef   = useRef<Record<string, number> | null>(null)
  const prevHeightRef = useRef<number | null>(null)
  const rowAnimsRef   = useRef<Animation[]>([])
  const heightAnimRef = useRef<Animation | null>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return

    // WRITE BEFORE READ, deliberately — this one has to come before the
    // measuring pass below. React has already pulled the leaving row out of
    // the DOM, so the very first geometry read forces a layout in which the
    // scroll container is shorter; one sitting at its bottom edge has its
    // scrollTop clamped down right there, a whole frame before the fold gets
    // to animate anything. Re-pinning after the fact can't help — the jump is
    // already in the committed layout. Holding the box at the height it had
    // last commit means that layout never shrinks in the first place, so the
    // clamp never fires and the fold below owns the shrink from start to end.
    // (A fold already in flight holds the box open by itself; see the inline
    // height it parks there.)
    const heldForRead = animateHeight && !heightAnimRef.current && prevHeightRef.current !== null
    if (heldForRead) container.style.height = `${prevHeightRef.current}px`

    // Read while the box is still held open, so this is the offset from before
    // the row left rather than a clamped one.
    //
    // requireOverflow: false — resolved per commit rather than cached on
    // mount, a list that doesn't overflow its pane yet still grows into one
    // later, and what's being asked here is which ancestor's *scroll
    // position* to pin, not whether it currently has anything to scroll. The
    // default (true) would find nothing yet, the scroller would cache as
    // null, and both halves of the scroll hold below would stay no-ops for
    // good: the fold would lose its pin, the offset would clamp in the one
    // layout that reads the natural height, and the list would snap to its
    // new size instead of shrinking in step with the animation.
    const scroller       = animateHeight ? findScrollParent(container, { requireOverflow: false }) : null
    const savedScrollTop = scroller ? scroller.scrollTop : 0

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

    const prev        = prevTopsRef.current
    const keysChanged = prev === null || !sameKeys(prev, tops)
    const anyMoved    = prev !== null && measured.some(m => {
      const prevTop = prev[m.key]
      return prevTop !== undefined && Math.abs(prevTop - m.layout) > 1
    })

    // An unrelated re-render (a keystroke in a row, a store tick) commits the
    // same layout. Leave any in-flight animation alone rather than restarting
    // it from scratch, which would stretch a 350ms fold out indefinitely.
    if (!keysChanged && !anyMoved) {
      if (heldForRead) container.style.height = ''
      return
    }

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
          { duration: DURATION, easing: EASING },
        ))
        continue
      }
      const from = prev?.[key] === undefined ? 0 : prev[key] - layout + ty
      if (Math.abs(from) <= 1) continue
      rowAnimsRef.current.push(row.animate(
        [{ transform: `translateY(${from}px)` }, { transform: 'translateY(0)' }],
        { duration: DURATION, easing: EASING },
      ))
    }

    if (animateHeight) {
      // A running height animation pins the container, so its measured height
      // is the animated value: that's where the fold has to resume from, but
      // the natural target can only be read back once it's cancelled.
      const running = heightAnimRef.current
      const from    = running ? cRect.height : prevHeightRef.current
      running?.cancel()
      heightAnimRef.current = null
      // Drop every hold — this run's pre-read one and any a previous fold
      // parked — so what we measure is the natural height, not one of ours.
      container.style.height = ''
      const target = container.getBoundingClientRect().height

      if ((keysChanged || running) && from !== null && Math.abs(from - target) > 1) {
        // Rows glide on the same duration and easing, so the bottom-most one
        // tracks the closing edge exactly and never gets cut off; clipping is
        // what turns a leaving row's fade into a fold.
        container.style.overflow = 'hidden'
        // Re-hold at `from` in the author origin as well. The fold's own first
        // frame does this from the animation origin (which outranks inline
        // style, so it still drives the visual), but only once styles are
        // recalculated — and the scroll restore below needs a layout that
        // already has the old height, this same tick.
        container.style.height = `${from}px`
        const anim = container.animate(
          [{ height: `${from}px` }, { height: `${target}px` }],
          { duration: DURATION, easing: EASING },
        )
        heightAnimRef.current = anim

        // Reading `target` above unheld the box for one layout, which is
        // enough for a bottom-pinned scroller to clamp. Put the offset back
        // now that the box is held open again; from here the browser's own
        // per-frame clamping walks it down in step with the fold.
        if (scroller) scroller.scrollTop = savedScrollTop

        void anim.finished.then(
          () => {
            if (heightAnimRef.current !== anim) return
            heightAnimRef.current = null
            container.style.overflow = ''
            container.style.height = ''
          },
          () => {/* cancelled — whichever run cancelled it owns the cleanup */},
        )
      } else {
        container.style.overflow = ''
      }
      prevHeightRef.current = target
    } else if (heldForRead) {
      container.style.height = ''
    }

    prevTopsRef.current = tops
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
 * Measures `rowEl` relative to a FlipList's box, for rendering a row that's
 * about to leave as an absolutely-positioned overlay among the list's
 * children. Pulling the leaving row out of flow this way — instead of
 * shrinking it in place — means the layout settles immediately, so the
 * FlipList sees one clean before/after diff and glides the surviving rows
 * into place while the overlay fades out on top.
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
