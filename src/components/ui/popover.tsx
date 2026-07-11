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
>(({ className, align = 'start', sideOffset = 4, style, ...props }, ref) => {
  // Same iOS/iPadOS keyboard issue as dialog.tsx: cap against the visual viewport,
  // not just Radix's own collision detection, so the combobox never renders taller
  // than what's actually visible above the keyboard.
  const viewportHeight = useVisualViewportHeight()
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
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
