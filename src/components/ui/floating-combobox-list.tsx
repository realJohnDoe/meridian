import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/cn'
import type { FloatingComboboxPlacement } from '@/hooks'

interface FloatingComboboxListProps {
  placement: FloatingComboboxPlacement | null
  listRef:   React.RefObject<HTMLDivElement | null>
  className?: string
  children:  React.ReactNode
}

// Portals the suggestion list to document.body and positions it per
// useFloatingCombobox's placement, independent of the (never-moving) input —
// see that hook for why the two float separately.
export function FloatingComboboxList({ placement, listRef, className, children }: FloatingComboboxListProps) {
  if (!placement) return null
  return createPortal(
    <div
      ref={listRef}
      data-side={placement.side}
      role="listbox"
      tabIndex={-1}
      // Keeps focus on the (never-moving) input while clicking a suggestion —
      // same pattern as editor/WikilinkPopup.tsx.
      onMouseDown={e => e.preventDefault()}
      className={cn(
        'fixed z-50 rounded-lg border border-input bg-popover p-0 shadow-lg overflow-y-auto',
        'outline-none animate-in fade-in-0 zoom-in-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      style={{
        left:      placement.left,
        maxWidth:  placement.maxWidth,
        maxHeight: placement.maxHeight,
        ...(placement.side === 'bottom' ? { top: placement.top } : { bottom: placement.bottom }),
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
