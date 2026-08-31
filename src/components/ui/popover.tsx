import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/cn'
import { useKeyboardInset } from '@/hooks'

function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />
}
function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />
}
function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  // Radix defaults this to 0, which lets a collision-shifted popover come to
  // rest exactly on the viewport edge — no breathing room at all on a phone,
  // where the trigger is usually near an edge to begin with. 14px matches the
  // screen edge (AgendaRow's mx-3.5) the rest of the app sits on.
  collisionPadding = 14,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  // The one part of the keyboard correction that CSS cannot express, and so the
  // only reason this file still diverges from the shadcn registry: Radix measures
  // collisions against the *layout* viewport, which an on-screen keyboard does not
  // shrink, so a popover anchored to a low trigger opens straight into the
  // keyboard. Feeding the covered strip in as bottom collision padding makes Radix
  // flip it above the trigger instead — and the Command's input sits at the top of
  // the popover, so a flipped-up one keeps that input in the visible band.
  //
  // Height capping needs no JS: --vv-height (published by useVisibleViewportCssVars)
  // already tracks the visible strip, so the max-h utility below handles it.
  const keyboardInset = useKeyboardInset()
  const resolvedCollisionPadding =
    keyboardInset > 0 ? { top: 14, bottom: keyboardInset + 14, left: 14, right: 14 } : collisionPadding

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={resolvedCollisionPadding}
        className={cn(
          'max-h-[calc(var(--vv-height,100svh)-2rem)]',
          'z-50 w-72 rounded-lg border border-input bg-popover p-0 shadow-lg overflow-y-auto',
          'outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
