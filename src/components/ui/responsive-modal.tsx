import * as React from 'react'
import { useMediaQuery } from '@/hooks'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './dialog'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerActions } from './drawer'
import { Separator } from './separator'
import { cn } from '@/lib/cn'

const ModalCtx = React.createContext(false) // false = mobile (drawer)

// ── Root ─────────────────────────────────────────────────────────

function ResponsiveModal({ open, onOpenChange, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const isDesktop = useMediaQuery("(min-width: 768px)")
  return (
    <ModalCtx.Provider value={isDesktop}>
      {isDesktop
        ? <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
        : <Drawer open={open} onOpenChange={onOpenChange}>{children}</Drawer>
      }
    </ModalCtx.Provider>
  )
}

// ── Content ───────────────────────────────────────────────────────
// Drawer: bottom sheet with drag handle.
// Dialog: centered modal — p-0/gap-0 so children own all spacing.

function ResponsiveModalContent({ className, children }: {
  className?: string
  children: React.ReactNode
}) {
  const isDesktop = React.useContext(ModalCtx)
  if (!isDesktop) {
    return <DrawerContent className={cn('pt-3', className)}>{children}</DrawerContent>
  }
  return (
    <DialogContent className={cn('max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-sm p-0 gap-0 overflow-hidden', className)}>
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
  const isDesktop = React.useContext(ModalCtx)
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
        'text-[11px] font-bold tracking-[.07em] uppercase text-muted-foreground',
        'px-[18px] pt-4 pb-2 pr-10',
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
  const isDesktop = React.useContext(ModalCtx)
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
  const isDesktop = React.useContext(ModalCtx)
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
