import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import { MOTION_MS, MOTION_EASE } from './motion'

/**
 * A list row that squeezes shut in flow on its way out, in pure CSS.
 *
 * **Why this rather than animating the list's height.** The list used to keep
 * its leaving row out of flow (an absolutely-positioned overlay) and animate
 * the *container* from its old height down to its new one. Nothing can read a
 * box's natural height without laying it out at that height first, so that
 * approach had to un-pin the container for one layout mid-effect — and one
 * layout at the shrunken size is all it takes for a scroller sitting at its
 * bottom edge to have its offset clamped, a whole frame before the fold
 * animates. Compensating for that meant saving and restoring the scroller's
 * offset around the measurement, which put the correctness of the animation on
 * top of correctly identifying the scroller — and that regressed twice (#843,
 * #850), silently and only on engines that clamp synchronously.
 *
 * `grid-template-rows: 1fr -> 0fr` needs no measurement at all: `1fr` already
 * *means* "this row's content height", so the transition runs from content
 * height to zero without anyone ever computing either. The row therefore never
 * stops being in flow, its height only ever changes continuously, and every
 * consequence — the list box shrinking, later siblings sliding up, the
 * scroller clamping — falls out of ordinary layout, per frame, for free. There
 * is no height to pin and no scroll offset to restore, so there is nothing
 * left for a wrong scroller to break.
 *
 * The two-box split is load-bearing: `0fr` sizes the *grid row*, and only a
 * child that may be smaller than its content (`overflow: hidden; min-height: 0`)
 * will actually be clipped by it. Collapsing a single box would leave the
 * content sticking out.
 *
 * `gap` is the parent list's own gap, and is what the collapsed row's negative
 * bottom margin cancels. A flex/grid parent puts a gap *between* items whatever
 * their height, so a row at height 0 still holds its gap open — the row would
 * finish its collapse one gap short of gone and then jump that last gap when it
 * unmounts. Cancelling it is exact for a row in any position, last included,
 * since a trailing gap and a trailing negative margin offset each other the
 * same way an interior pair does.
 */
// Attributes are typed against `HTMLElement`, not a concrete tag: `as` makes
// the rendered element a union, and only handlers written against the shared
// supertype are assignable to every member of it. No `ref` either — the
// collapse needs the element for its own `transitionend` listener.
interface CollapseRowProps extends React.HTMLAttributes<HTMLElement> {
  /** Drive to true to play the collapse; the row stays mounted until it ends. */
  collapsed: boolean
  /** Fired once the row has finished collapsing and is safe to unmount. */
  onCollapsed?: () => void
  /** The parent list's gap, as a CSS length — see the note above. */
  gap?: string
  /** The element to render. `li` for a row that is a direct child of a list. */
  as?: 'div' | 'li'
}

export function CollapseRow(props: CollapseRowProps) {
  // Defaults pulled out into `??` rather than written as destructured-parameter
  // defaults: that shape makes babel-plugin-react-compiler silently skip
  // memoizing the whole component. See OccurrenceCard.tsx for the full
  // rationale.
  const { collapsed, onCollapsed, gap, as, style, children, ...rest } = props
  const Tag = as ?? 'div'
  // A callback ref rather than an object one: `Tag` is a union, so an object
  // ref would have to satisfy both `Ref<HTMLDivElement>` and `Ref<HTMLLIElement>`
  // at once. A callback taking the shared supertype satisfies either.
  const elRef = useRef<HTMLElement | null>(null)
  const setEl = useCallback((el: HTMLElement | null) => { elRef.current = el }, [])

  // Read through a ref so the effect below depends only on `collapsed`. An
  // inline `onCollapsed` is a new function every render, and depending on it
  // would restart the safety timer on every unrelated re-render — the same
  // "a stray render resets the clock" failure the fold used to have.
  const onCollapsedRef = useRef(onCollapsed)
  useEffect(() => { onCollapsedRef.current = onCollapsed }, [onCollapsed])

  useEffect(() => {
    if (!collapsed) return
    const el = elRef.current
    if (!el) return

    let fired = false
    const finish = () => {
      if (fired) return
      fired = true
      onCollapsedRef.current?.()
    }
    // Only this row's own collapse counts: `transitionend` bubbles, so a
    // transition on anything rendered inside the row would otherwise unmount it
    // early, mid-collapse.
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === 'grid-template-rows') finish()
    }
    el.addEventListener('transitionend', onEnd)
    // A transition that never runs never ends: a row collapsed inside a hidden
    // subtree, or under a UA that refuses the interpolation, would strand
    // itself in the list forever. Time out rather than trust the event.
    const timer = window.setTimeout(finish, MOTION_MS + 120)

    return () => {
      el.removeEventListener('transitionend', onEnd)
      window.clearTimeout(timer)
    }
  }, [collapsed])

  return (
    <Tag
      ref={setEl}
      // Inline rather than utility classes so the duration and easing come from
      // the same constants the FLIP glide uses, with no second copy to drift.
      style={{
        display: 'grid',
        gridTemplateRows: collapsed ? '0fr' : '1fr',
        opacity: collapsed ? 0 : 1,
        marginBottom: collapsed && gap ? `-${gap}` : 0,
        transitionProperty: 'grid-template-rows, opacity, margin-bottom',
        transitionDuration: `${MOTION_MS}ms`,
        transitionTimingFunction: MOTION_EASE,
        ...style,
      }}
      // `inert` rather than `aria-hidden`: the row still holds real buttons
      // while it collapses, and hiding a focusable subtree from assistive tech
      // without also taking it out of the tab order is worse than leaving it
      // alone. `inert` does both, plus makes it unclickable.
      inert={collapsed}
      {...rest}
    >
      <div style={{ overflow: 'hidden', minHeight: 0 }}>{children}</div>
    </Tag>
  )
}
