import { useMediaQuery } from "./use-media-query"

/**
 * Touch-first devices (phone or tablet, e.g. iPad) get the collapsible
 * hamburger sidebar; mouse/trackpad devices get the persistent sidebar.
 * Keyed on pointer type rather than width so a wide touch device doesn't
 * end up with a permanently-pinned sidebar competing with touch-first
 * overlays (e.g. the full-screen search layer, also gated on pointer type).
 */
export function useIsMobile() {
  return useMediaQuery("(pointer: coarse)")
}
