import * as React from 'react'
import { X } from 'lucide-react'
import { useIsMobile } from '@/hooks/use-mobile'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './dialog'
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription, DrawerActions } from './drawer'
import { Separator } from './separator'
import { Button } from './button'
import { cn } from '@/lib/utils'

const ModalCtx = React.createContext(true)

// ── Root ─────────────────────────────────────────────────────────

function ResponsiveModal({ open, onOpenChange, children }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  const isMobile = useIsMobile()
  return (
    <ModalCtx.Provider value={isMobile}>
      {isMobile
        ? <Drawer open={open} onOpenChange={onOpenChange}>{children}</Drawer>
        : <Dialog open={open} onOpenChange={onOpenChange}>{children}</Dialog>
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
  const isMobile = React.useContext(ModalCtx)
  if (isMobile) {
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
  const isMobile = React.useContext(ModalCtx)
  if (isMobile) {
    return (
      <>
        <DrawerTitle className={className}>{children}</DrawerTitle>
        <Separator />
      </>
    )
  }
  return (
    <>
      <div className={cn(
        'text-[11px] font-bold tracking-[.07em] uppercase text-muted-foreground',
        'px-[18px] pt-4 pb-2 pr-10',
        className,
      )}>
        <DialogTitle className="text-[11px] font-bold tracking-[.07em] uppercase text-muted-foreground">
          {children}
        </DialogTitle>
      </div>
      <Separator />
    </>
  )
}

// ── Description (always sr-only) ──────────────────────────────────

function ResponsiveModalDescription({ children }: { children: React.ReactNode }) {
  const isMobile = React.useContext(ModalCtx)
  if (isMobile) {
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
  const isMobile = React.useContext(ModalCtx)
  if (isMobile) {
    return (
      <DrawerActions
        onRemove={onRemove}
        onCancel={onCancel}
        onSet={onSet}
        removeLabel={removeLabel}
        setDisabled={setDisabled}
      />
    )
  }
  return (
    <>
      <Separator />
      <div className="flex items-center justify-between px-4 pt-4 pb-4">
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
      </div>
    </>
  )
}

export {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalTitle,
  ResponsiveModalDescription,
  ResponsiveModalActions,
}
