/**
 * SurfaceButton — a layout-neutral interactive surface built on shadcn Button.
 *
 * Use this as a drop-in for click-only <div>s that need keyboard / SR support
 * but whose visual layout is entirely caller-controlled via className.
 *
 * Compared to raw `Button variant="ghost"`:
 * - No min-height / padding / font-weight presets
 * - No default hover background (callers supply their own via className)
 * - Inherits shadcn's focus-visible ring and disabled states
 */
import * as React from 'react'
import { Button } from './button'
import { cn } from '@/lib/utils'

export type SurfaceButtonProps = React.ComponentPropsWithoutRef<typeof Button>

const SurfaceButton = React.forwardRef<HTMLButtonElement, SurfaceButtonProps>(
  ({ className, ...props }, ref) => (
    <Button
      ref={ref}
      variant="ghost"
      className={cn(
        // reset Button's opinionated defaults
        'h-auto p-0 font-normal justify-start text-left whitespace-normal',
        // caller owns hover styling
        'hover:bg-transparent',
        className,
      )}
      {...props}
    />
  ),
)
SurfaceButton.displayName = 'SurfaceButton'

export { SurfaceButton }
