import type { ReactNode } from 'react'

/**
 * Which of the five app views is mounted. The one piece of the discriminant
 * the shell still needs as a *value* rather than a branch: `_app.tsx` keys
 * its close-the-quick-nav-panel effect off this, so paging *within* a view
 * (chevron taps, swipes — which change route params but not the kind) leaves
 * an open panel open, while switching views closes it.
 */
type ViewKind = 'day' | 'week' | 'month' | 'list' | 'agenda'

/**
 * Everything `_app.tsx`'s chrome — the topbar and the quick-nav panel — needs
 * to know about whichever view is currently mounted, as data.
 *
 * This is the seam that keeps the shell out of the per-view business. The
 * shell reads these five fields and never asks which view it is looking at;
 * each view answers for itself in its own `use*Chrome` hook
 * (`-dayChrome.tsx`, `-weekChrome.tsx`, `-monthChrome.tsx`, `-listChrome.ts`,
 * `-agendaChrome.tsx`), and `-useViewChrome.ts` picks the one that matched.
 * Adding a view is a new adapter plus one line there — no edit to the shell.
 *
 * Note what the three nullable fields buy: they turn "which view is this?"
 * into "what does this view have?", which is the question the shell actually
 * has. `paging: null` is what makes the agenda's topbar unpaged, `quickNav:
 * null` is the whole of what makes Backlog/Notes panel-less (no inline card,
 * no PopoverContent, no swipe-to-toggle), and `onToday: null` is what drops
 * their Today button. None of those sites names a view.
 */
export interface ViewChrome {
  kind: ViewKind
  /** The topbar's label. Already preview-aware where the view has a carousel. */
  label: string
  /**
   * Prev/next chevron paging, or null for a view that has none (agenda pages
   * by scrolling; Backlog/Notes don't page at all). `unit` is the noun for
   * the buttons' accessible names ("Previous day", "Next week", …).
   *
   * Every implementation navigates with `replace: true`. Stated once here
   * rather than per adapter because it is a property of this contract, not a
   * coincidence of three call sites: it mirrors each carousel's own
   * swipe-to-page semantics (see DayView/WeekView/MonthView), so chevron taps
   * and swipes leave the same single history entry per visit instead of
   * stacking a back-press-per-unit trail.
   */
  paging: { unit: string; onPrev: () => void; onNext: () => void } | null
  /** What the topbar's Today button does, or null for a view that shows none. */
  onToday: (() => void) | null
  /**
   * The quick-nav panel's body for this view, or null for a view that has no
   * panel. A function rather than a node because the shell renders it twice
   * per pass with different `monthNav` — the mobile inline card pages by
   * MonthStrip's chip row, the desktop popover by each grid's own chevrons
   * (see `renderQuickNavPanel`'s call sites in `_app.tsx`).
   */
  quickNav: ((monthNav: 'strip' | 'buttons') => ReactNode) | null
}

/**
 * Derives a "preview-aware" display value from a route value and its
 * optional preview key (monthPreview/dayPreview/weekPreview, set by a swipe
 * carousel on touchend, ahead of the route committing — see viewState.ts) —
 * the pattern each of Month/Day/Week's own chrome adapter uses for its topbar
 * label and quick-nav panel props. Falls back to `raw` when there's no
 * preview, or `parse` can't make sense of one (a malformed key should never
 * happen, but the parse functions return null/undefined on invalid input, and
 * a fallback beats blowing up on it).
 */
export function previewAware<T>(raw: T, previewKey: string | null, parse: (key: string) => T | null | undefined): T {
  if (!previewKey) return raw
  return parse(previewKey) ?? raw
}
