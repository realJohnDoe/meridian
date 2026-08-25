export interface FloatingAnchorRect {
  top:    number
  bottom: number
  left:   number
}

export interface FloatingViewport {
  visibleTop:    number
  visibleBottom: number
  innerWidth:    number
  innerHeight:   number
}

export interface FloatingPlacement {
  side:      'bottom' | 'top'
  left:      number
  maxWidth:  number
  maxHeight: number
  top?:      number
  bottom?:   number
}

const GAP = 6
const MARGIN = 8
const MIN_LIST = 160

/**
 * Space a panel may occupy on one side of its anchor.
 *
 * Clamped to what is actually there, never floored up to a preferred size: a
 * floor larger than the gap makes the panel overrun the band, and on the flipped
 * side that overrun is upward, straight into the topbar — visible even while the
 * anchor itself is still perfectly in view. The flip below already picks the
 * roomier side, and the panel scrolls its own contents, so a short panel is the
 * honest answer when the room is short.
 */
function fit(space: number): number {
  return Math.max(0, space - GAP - MARGIN)
}

/**
 * Flips a floating panel above/below an anchor rect based on available
 * space, and clamps its width/height to the viewport. Shared by
 * useFloatingCombobox (anchored to a real element's rect) and WikilinkPopup
 * (anchored to a point — the editor cursor coords, as a zero-height rect).
 *
 * Returns `null` when the anchor has left the usable band entirely — scrolled
 * up behind the topbar, or down past the keyboard. A panel is positioned
 * *from* its anchor, so once the anchor is gone the panel has nothing to point
 * at: tracking it anyway parks a detached list over the chrome, and clamping it
 * into view is worse still, since it then points at an input the user cannot
 * see. Hiding matches what floating-ui calls `referenceHidden`. Both callers
 * already treat a null placement as "render nothing".
 *
 * Callers are responsible for passing a `visibleTop` that already excludes any
 * chrome painted over the viewport — see lib/topChrome.ts. Keeping that a
 * caller concern is what lets this stay a pure function with no DOM access.
 */
export function computeFloatingPlacement(
  anchor: FloatingAnchorRect,
  viewport: FloatingViewport,
): FloatingPlacement | null {
  // Anchor fully above the usable band (behind the topbar) or fully below it
  // (behind the keyboard). `<=` rather than `<` so a zero-height anchor resting
  // exactly on the boundary — the WikilinkPopup's cursor point — counts as gone.
  if (anchor.bottom <= viewport.visibleTop || anchor.top >= viewport.visibleBottom) return null

  const spaceBelow = viewport.visibleBottom - anchor.bottom
  const spaceAbove = anchor.top - viewport.visibleTop
  const maxWidth = Math.max(160, viewport.innerWidth - anchor.left - MARGIN)

  if (spaceBelow >= MIN_LIST || spaceBelow >= spaceAbove) {
    return {
      side: 'bottom',
      left: anchor.left,
      maxWidth,
      top: anchor.bottom + GAP,
      maxHeight: fit(spaceBelow),
    }
  }

  return {
    side: 'top',
    left: anchor.left,
    maxWidth,
    bottom: viewport.innerHeight - anchor.top + GAP,
    maxHeight: fit(spaceAbove),
  }
}
