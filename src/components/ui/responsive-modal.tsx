import * as React from 'react'
import { useMediaQuery } from '@/hooks'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './dialog'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerActions } from './drawer'
import { Separator } from './separator'
import { cn } from '@/lib/cn'

const ModalCtx = React.createContext(false) // false = mobile (drawer)

// ── Root ─────────────────────────────────────────────────────────

function ResponsiveModal({ open, onOpenChange, forceDialog, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Always render the centered Dialog shell, even below the desktop breakpoint.
   *  For pickers that read poorly as a drawer (e.g. scroll wheels) or that are
   *  nested inside another drawer (to avoid stacking two bottom sheets). */
  forceDialog?: boolean
  children: React.ReactNode
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)") || !!forceDialog
  return (
    <ModalCtx value={isDesktop}>
      {isDesktop
        ? <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
        : <Drawer open={open} onOpenChange={onOpenChange}>{children}</Drawer>
      }
    </ModalCtx>
  )
}

// ── Content ───────────────────────────────────────────────────────
// Drawer: bottom sheet with drag handle.
// Dialog: centered modal — p-0/gap-0 so children own all spacing.

function ResponsiveModalContent({ className, children }: {
  className?: string
  children: React.ReactNode
}) {
  const isDesktop = React.use(ModalCtx)
  if (!isDesktop) {
    return <DrawerContent className={cn('pt-3', className)}>{children}</DrawerContent>
  }
  return (
    <DialogContent className={cn('max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-sm p-0 gap-0', className)}>
      {children}
    </DialogContent>
  )
}

// ── Title + separator ─────────────────────────────────────────────
// Both modes use the same small-caps label and a hairline separator.
// Dialog: extra right padding to clear the built-in close button.

function ResponsiveModalTitle({ children, className }: {
  children: React.ReactNode
  className?: string
}) {
  const isDesktop = React.use(ModalCtx)
  if (!isDesktop) {
    return (
      <>
        <DrawerTitle className={className}>{children}</DrawerTitle>
        <Separator />
      </>
    )
  }
  return (
    <>
      <DialogTitle className={cn(
        'text-2xs font-bold tracking-[.07em] uppercase text-muted-foreground',
        'px-4.5 pt-4 pb-2 pr-10',
        className,
      )}>
        {children}
      </DialogTitle>
      <Separator />
    </>
  )
}

// ── Description (always sr-only) ──────────────────────────────────

function ResponsiveModalDescription({ children }: { children: React.ReactNode }) {
  const isDesktop = React.use(ModalCtx)
  if (!isDesktop) {
    return <DrawerDescription className="sr-only">{children}</DrawerDescription>
  }
  return <DialogDescription className="sr-only">{children}</DialogDescription>
}

// ── Actions footer ────────────────────────────────────────────────
// Separator + Remove / Cancel / Set row — same layout in both modes.

interface ResponsiveModalActionsProps {
  onRemove: () => void
  onCancel: () => void
  onSet: () => void
  removeLabel?: string
  setDisabled?: boolean
}

function ResponsiveModalActions({
  onRemove, onCancel, onSet, removeLabel = 'Remove', setDisabled,
}: ResponsiveModalActionsProps) {
  const isDesktop = React.use(ModalCtx)
  return (
    <DrawerActions
      onRemove={onRemove}
      onCancel={onCancel}
      onSet={onSet}
      removeLabel={removeLabel}
      setDisabled={setDisabled}
      className={isDesktop ? 'pb-4' : undefined}
    />
  )
}

export {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
}
