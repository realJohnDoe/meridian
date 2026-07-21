import * as React from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/lib/cn'
import { useVisualViewportHeight } from '@/hooks'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = 'start', sideOffset = 4, collisionPadding, style, ...props }, ref) => {
  // Same iOS/iPadOS keyboard issue as dialog.tsx: cap against the visual viewport,
  // not just Radix's own collision detection, so the combobox never renders taller
  // than what's actually visible above the keyboard.
  const viewportHeight = useVisualViewportHeight()

  // The on-screen keyboard shrinks the *visual* viewport but not the *layout*
  // viewport that Radix's collision detection measures against — so by default a
  // popover anchored to a low trigger opens straight into the keyboard. Feed the
  // keyboard-covered strip in as bottom collision padding so Radix flips the
  // popover above the trigger instead. The input lives at the top of the
  // Command, so a flipped-up popover keeps it in the visible band.
  //
  // The 120px floor distinguishes a real keyboard from the small viewport/layout
  // delta desktop browsers show (scrollbars, chrome) so those don't add padding.
  const rawInset =
    viewportHeight != null && typeof window !== 'undefined'
      ? window.innerHeight - viewportHeight
      : 0
  const keyboardInset = rawInset > 120 ? rawInset : 0
  const resolvedCollisionPadding =
    keyboardInset > 0 ? { top: 8, bottom: keyboardInset + 8, left: 8, right: 8 } : collisionPadding

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        collisionPadding={resolvedCollisionPadding}
        style={{
          ...(viewportHeight != null ? { maxHeight: `calc(${viewportHeight}px - 2rem)` } : {}),
          ...style,
        }}
        className={cn(
          'z-50 w-72 rounded-lg border border-input bg-popover p-0 shadow-lg overflow-y-auto',
          'outline-none data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
