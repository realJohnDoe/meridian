import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { DismissableLayer } from '@radix-ui/react-dismissable-layer'
import { Command, type CommandInput } from '@/components/ui/command'
import { useVisualViewportHeight, useVisualViewportOffsetTop } from '@/hooks'
import { cn } from '@/lib/cn'

// ~4.5 rows — reused from PR 1's list min-height, now used as a cap instead
// of a floor since the list shrinks to content.
const MAX_LIST_HEIGHT_PX = 192
const VIEWPORT_MARGIN_PX = 16

export type ComboboxSide = 'above' | 'below'

interface InlineComboboxRenderProps {
  side:        ComboboxSide
  maxHeightPx: number
  inputRef:    RefObject<React.ComponentRef<typeof CommandInput> | null>
}

interface InlineComboboxProps {
  open:          boolean
  onClose:       () => void
  shouldFilter?: boolean
  className?:    string
  children:      (props: InlineComboboxRenderProps) => ReactNode
}

// Renders the combobox's input in normal document flow (not a Radix Popover
// portal) so the platform's native "scroll the focused element into view"
// keeps it above the on-screen keyboard on mobile. This is a deliberate
// departure from the shadcn Popover+Command recipe: cmdk queries
// `[cmdk-item]` against the Command root (`rootRef.current.querySelectorAll`),
// so the list must stay a DOM descendant of the same root as the input —
// portaling just the list away (what Popover does) breaks arrow-key nav and
// selection. Dismissal (Escape / outside click / focus leaving) is provided
// by Radix's DismissableLayer primitive standalone, so we keep maintained
// dismiss behavior without pulling in the whole (portaling) Popover.
export default function InlineCombobox({ open, onClose, shouldFilter, className, children }: InlineComboboxProps) {
  const rootRef  = useRef<React.ComponentRef<typeof Command>>(null)
  const inputRef = useRef<React.ComponentRef<typeof CommandInput>>(null)
  const [side, setSide] = useState<ComboboxSide>('below')
  const [maxHeightPx, setMaxHeightPx] = useState(MAX_LIST_HEIGHT_PX)

  const viewportHeight    = useVisualViewportHeight()
  const viewportOffsetTop = useVisualViewportOffsetTop()

  // Decide open direction from real room above vs below the input, measured
  // against the *visual* viewport (keyboard-aware — the layout viewport
  // doesn't shrink when the keyboard opens). Held steady while typing
  // narrows the list (this effect doesn't depend on the query); re-measured
  // whenever the visual viewport actually changes — keyboard open/close,
  // scroll, or orientation — which is exactly when the input may have moved.
  useLayoutEffect(() => {
    if (!open) return
    function measure() {
      const el = rootRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const vh = viewportHeight ?? window.innerHeight
      const top = viewportOffsetTop ?? 0
      const bottom = top + vh
      const roomBelow = bottom - rect.bottom
      const roomAbove = rect.top - top
      setSide(roomBelow >= roomAbove ? 'below' : 'above')
      const room = Math.max(roomBelow, roomAbove) - VIEWPORT_MARGIN_PX
      setMaxHeightPx(Math.max(0, Math.min(MAX_LIST_HEIGHT_PX, room)))
    }
    measure()
    const vv = window.visualViewport
    vv?.addEventListener('resize', measure)
    vv?.addEventListener('scroll', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      vv?.removeEventListener('resize', measure)
      vv?.removeEventListener('scroll', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [open, viewportHeight, viewportOffsetTop])

  // Focus the input whenever the combobox opens so typing can start
  // immediately. A ref-effect rather than `autoFocus` (jsx-a11y/no-autofocus).
  useLayoutEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <DismissableLayer
      onDismiss={onClose}
      // Stop Escape from also reaching a host that dismisses on it (e.g. the
      // Settings drawer) — DismissableLayer still closes us via onDismiss.
      onEscapeKeyDown={e => e.stopPropagation()}
    >
      <Command
        ref={rootRef}
        shouldFilter={shouldFilter}
        className={cn('relative h-auto w-auto overflow-visible', className)}
      >
        {children({ side, maxHeightPx, inputRef })}
      </Command>
    </DismissableLayer>
  )
}

// Shared styling for the two combobox surfaces (rendered per-consumer, not
// wrapped here, so each picker controls its own content):
//   - the input box, replacing the border the old PopoverContent supplied
//   - the floating list, anchored to the input's top or bottom edge
export const comboboxInputClassName = 'rounded-lg border border-input bg-background'

export function comboboxListClassName(side: ComboboxSide, className?: string) {
  return cn(
    'absolute z-40 rounded-lg border border-input bg-popover shadow-lg overflow-y-auto overflow-x-hidden',
    side === 'below' ? 'top-full mt-1' : 'bottom-full mb-1',
    className,
  )
}
