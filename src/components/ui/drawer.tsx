import * as React from 'react'
import { Drawer as DrawerPrimitive } from 'vaul'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './button'
import { Separator } from './separator'

const Drawer = DrawerPrimitive.Root
const DrawerTrigger = DrawerPrimitive.Trigger
const DrawerPortal = DrawerPrimitive.Portal
const DrawerClose = DrawerPrimitive.Close

// ── Overlay ─────────────────────────────────────────────────────
function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      className={cn('fixed inset-0 z-50 bg-black/70', className)}
      {...props}
    />
  )
}

// ── Content ──────────────────────────────────────────────────────
// Centered and width-capped to match the app shell (430 px).
// Includes a drag handle for mobile swipe-to-dismiss affordance.
// Capped to the dynamic viewport height and split into a fixed drag handle
// plus a scrollable body: content taller than the screen (a long form, a
// vault list that grows with each added vault) used to push its top past the
// top of the viewport with nothing able to scroll it back into view, because
// a position:fixed sheet with no height cap just keeps growing. `min-h-0` on
// the scroll region is required for it to actually shrink inside the flex
// column instead of forcing the column itself to grow past `max-h`.
function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal>
      <DrawerOverlay />
      <DrawerPrimitive.Content
        className={cn(
          'fixed bottom-0 left-1/2 z-50 -translate-x-1/2',
          'w-full max-w-md lg:max-w-lg max-h-[85dvh] flex flex-col',
          'bg-background border-t border-border rounded-t-3xl',
          'pb-6 focus:outline-none',
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1 w-24 shrink-0 rounded-full bg-muted" />
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

// ── Layout helpers ───────────────────────────────────────────────
const DrawerHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col', className)} {...props} />
)
DrawerHeader.displayName = 'DrawerHeader'

const DrawerFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex items-center justify-between px-4 pt-4', className)}
    {...props}
  />
)
DrawerFooter.displayName = 'DrawerFooter'

// ── Title ────────────────────────────────────────────────────────
function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      className={cn(
        'text-2xs font-bold tracking-[.07em] uppercase text-muted-foreground',
        'px-4.5 pt-1 pb-2',
        className,
      )}
      {...props}
    />
  )
}

// ── Description (sr-only by default) ────────────────────────────
function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      className={cn('sr-only', className)}
      {...props}
    />
  )
}

// ── Actions footer ───────────────────────────────────────────────
// Renders Separator + the standard Remove / Cancel / Set row.
// Used by every property drawer so the layout is defined once.
interface DrawerActionsProps {
  onRemove: () => void
  onCancel: () => void
  onSet: () => void
  removeLabel?: string
  setDisabled?: boolean
  className?: string
}

const DrawerActions = ({ onRemove, onCancel, onSet, removeLabel = 'Remove', setDisabled, className }: DrawerActionsProps) => (
  <>
    <Separator />
    <DrawerFooter className={className}>
      <Button
        variant="outline"
        size="sm"
        className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
        onClick={onRemove}
      >
        <X size={13} />
        {removeLabel}
      </Button>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={setDisabled} onClick={onSet}>Set</Button>
      </div>
    </DrawerFooter>
  </>
)
DrawerActions.displayName = 'DrawerActions'

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
  DrawerActions,
}
