import * as React from 'react'
import * as SheetPrimitive from '@radix-ui/react-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const Sheet = SheetPrimitive.Root
const SheetTrigger = SheetPrimitive.Trigger
const SheetClose = SheetPrimitive.Close
const SheetPortal = SheetPrimitive.Portal

// ── Overlay ─────────────────────────────────────────────────────
const SheetOverlay = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-[200] bg-black/70',
      'transition-opacity duration-200',
      'data-[state=open]:opacity-100 data-[state=closed]:opacity-0',
      className,
    )}
    {...props}
  />
))
SheetOverlay.displayName = 'SheetOverlay'

// ── Content variants ─────────────────────────────────────────────
const sheetVariants = cva(
  // Shared: stacking, background, focus reset
  'fixed z-[200] bg-background focus:outline-none',
  {
    variants: {
      side: {
        bottom: [
          // Horizontal centering + width cap matching the app shell
          'bottom-0 left-1/2 -translate-x-1/2',
          'w-full max-w-[430px]',
          // Shape
          'border-t border-border rounded-t-[24px]',
          // Slide-up animation via Radix data-state
          'translate-y-full transition-transform duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]',
          'data-[state=open]:translate-y-0',
        ],
        top: [
          'top-0 left-1/2 -translate-x-1/2',
          'w-full max-w-[430px]',
          'border-b border-border rounded-b-[24px]',
          '-translate-y-full transition-transform duration-[280ms] ease-[cubic-bezier(.4,0,.2,1)]',
          'data-[state=open]:translate-y-0',
        ],
      },
    },
    defaultVariants: { side: 'bottom' },
  },
)

interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof SheetPrimitive.Content>,
    VariantProps<typeof sheetVariants> {}

const SheetContent = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Content>,
  SheetContentProps
>(({ side, className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <SheetPrimitive.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
    </SheetPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = 'SheetContent'

// ── Convenience layout helpers ───────────────────────────────────
const SheetHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col', className)} {...props} />
)
SheetHeader.displayName = 'SheetHeader'

const SheetFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center justify-between border-t border-border', className)} {...props} />
)
SheetFooter.displayName = 'SheetFooter'

// ── Title ────────────────────────────────────────────────────────
// Styled as the app's standard bottom-sheet section label.
const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Title>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Title
    ref={ref}
    className={cn(
      'text-[11px] font-bold tracking-[.07em] uppercase text-muted-foreground',
      'px-[18px] pt-1 pb-2 border-b border-border',
      className,
    )}
    {...props}
  />
))
SheetTitle.displayName = 'SheetTitle'

// ── Description (visually hidden by default, keeps a11y happy) ──
const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof SheetPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof SheetPrimitive.Description>
>(({ className, ...props }, ref) => (
  <SheetPrimitive.Description
    ref={ref}
    className={cn('sr-only', className)}
    {...props}
  />
))
SheetDescription.displayName = 'SheetDescription'

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
