import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { cn } from '@/lib/utils'

const Drawer = DrawerPrimitive.Root
const DrawerTrigger = DrawerPrimitive.Trigger
const DrawerPortal = DrawerPrimitive.Portal
const DrawerClose = DrawerPrimitive.Close

// ── Overlay ─────────────────────────────────────────────────────
const DrawerOverlay = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    className={cn('fixed inset-0 z-[200] bg-black/70', className)}
    {...props}
  />
))
DrawerOverlay.displayName = 'DrawerOverlay'

// ── Content ──────────────────────────────────────────────────────
// Centered and width-capped to match the app shell (430 px).
// No drag handle — this app is not a native-style swipe drawer.
const DrawerContent = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      className={cn(
        'fixed bottom-0 left-1/2 z-[200] -translate-x-1/2',
        'w-full max-w-[430px]',
        'bg-background border-t border-border rounded-t-[24px]',
        'focus:outline-none',
        className,
      )}
      {...props}
    >
      <div className="mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted" />
      {children}
    </DrawerPrimitive.Content>
  </DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

// ── Layout helpers ───────────────────────────────────────────────
const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col', className)} {...props} />
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex items-center justify-between border-t border-border', className)}
    {...props}
  />
)
DrawerFooter.displayName = 'DrawerFooter'

// ── Title ────────────────────────────────────────────────────────
const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Title
    ref={ref}
    className={cn(
      'text-[11px] font-bold tracking-[.07em] uppercase text-muted-foreground',
      'px-[18px] pt-1 pb-2 border-b border-border',
      className,
    )}
    {...props}
  />
))
DrawerTitle.displayName = 'DrawerTitle'

// ── Description (sr-only by default) ────────────────────────────
const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DrawerPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Description
    ref={ref}
    className={cn('sr-only', className)}
    {...props}
  />
))
DrawerDescription.displayName = 'DrawerDescription'

export {
  Drawer,
  DrawerTrigger,
  DrawerPortal,
  DrawerClose,
  DrawerOverlay,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
