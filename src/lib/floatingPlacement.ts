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
 * Flips a floating panel above/below an anchor rect based on available
 * space, and clamps its width/height to the viewport. Shared by
 * useFloatingCombobox (anchored to a real element's rect) and WikilinkPopup
 * (anchored to a point — the editor cursor coords, as a zero-height rect).
 */
export function computeFloatingPlacement(
  anchor: FloatingAnchorRect,
  viewport: FloatingViewport,
): FloatingPlacement {
  const spaceBelow = viewport.visibleBottom - anchor.bottom
  const spaceAbove = anchor.top - viewport.visibleTop
  const maxWidth = Math.max(160, viewport.innerWidth - anchor.left - MARGIN)

  if (spaceBelow >= MIN_LIST || spaceBelow >= spaceAbove) {
    return {
      side: 'bottom',
      left: anchor.left,
      maxWidth,
      top: anchor.bottom + GAP,
      maxHeight: Math.max(120, spaceBelow - GAP - MARGIN),
    }
  }

  return {
    side: 'top',
    left: anchor.left,
    maxWidth,
    bottom: viewport.innerHeight - anchor.top + GAP,
    maxHeight: Math.max(120, spaceAbove - GAP - MARGIN),
  }
}
