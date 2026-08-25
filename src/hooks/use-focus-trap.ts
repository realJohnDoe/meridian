import { useEffect, type RefObject } from 'react'

// What the browser would stop at while tabbing. Deliberately structural (a
// selector + attribute checks) rather than geometric: jsdom reports every
// element as unlaid-out, so anything filtering on `offsetParent` or
// `getBoundingClientRect()` would find zero tabbables under test and silently
// degrade the trap into a no-op exactly where it is asserted.
const TABBABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  '[contenteditable]',
  '[tabindex]',
].join(',')

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(el =>
    !el.hasAttribute('disabled') &&
    el.getAttribute('tabindex') !== '-1' &&
    el.getAttribute('aria-hidden') !== 'true' &&
    !el.hidden,
  )
}

interface FocusTrapOptions {
  /** Element to focus when the trap activates. Defaults to the container itself. */
  initialFocus?: RefObject<HTMLElement | null>
  /**
   * Return focus to whatever held it before the trap activated, on deactivate.
   * On by default — turn it off only where re-focusing that element has a side
   * effect (e.g. a text input whose refocus would raise the soft keyboard).
   */
  restoreFocus?: boolean
}

/**
 * Keeps Tab inside `containerRef` while `active`, the missing half of
 * `role="dialog" aria-modal="true"` on an overlay that isn't a radix Dialog.
 * Without it a keyboard user tabs straight out of the overlay and into the
 * application behind it, which the markup has just told a screen reader is
 * inert.
 *
 * Reach for `ResponsiveModal` instead wherever the overlay can be a real
 * modal — it gets trap, restore, escape and scroll-lock from radix. This hook
 * is for the two that can't: `search/SearchOverlay` (mobile-only, and its
 * desktop branch deliberately keeps focus outside its own tree) and
 * `onboarding/CoachTour` (positioned card over a *visible*, still-interactive
 * app — a radix overlay would black out the very screen the tour points at).
 *
 * Only the Tab key is intercepted, never focus events: pointer users can still
 * click into the app behind a non-blocking overlay, and the next Tab pulls
 * them back in.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  options: FocusTrapOptions = {},
): void {
  const { initialFocus, restoreFocus = true } = options

  useEffect(() => {
    if (!active) return
    const root = containerRef.current
    if (!root) return

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    ;(initialFocus?.current ?? root).focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Tab' || e.defaultPrevented) return
      const items = tabbables(root!)
      if (items.length === 0) {
        e.preventDefault()
        root!.focus()
        return
      }
      const first = items[0]!
      const last = items[items.length - 1]!
      const focused = document.activeElement

      // Focus escaped the overlay (a background click, or a control that was
      // disabled out from under it) — Tab re-enters rather than continuing
      // wherever it left off.
      if (!(focused instanceof HTMLElement) || !root!.contains(focused)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      // Wrap at the ends. Shift+Tab off the container itself wraps too: it
      // holds tabindex=-1 and sits before every item in tab order.
      if (!e.shiftKey && focused === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && (focused === first || focused === root)) {
        e.preventDefault()
        last.focus()
      }
    }

    // Capture, so the trap runs ahead of any app-level key handling that might
    // stop propagation before the event reaches document.
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      if (restoreFocus && previous?.isConnected && previous !== document.body) previous.focus()
    }
  }, [active, containerRef, initialFocus, restoreFocus])
}
