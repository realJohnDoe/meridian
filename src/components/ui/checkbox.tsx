import * as React from 'react'
import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/cn'

function Checkbox({
  className,
  visualClassName,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root> & { visualClassName?: string }) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'group relative shrink-0 touch-manipulation',
        // Expand touch target to 44px without affecting layout or visual size
        "before:absolute before:-inset-3 before:content-['']",
        'focus-visible:outline-none',
        'disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      <span className={cn(
        'size-5 rounded-full border-2 border-muted-foreground flex items-center justify-center',
        'transition-colors duration-150',
        // `indeterminate` ("some, not all") gets the same fill as `checked` so
        // it reads as "on" at a glance — only the glyph inside (dash vs. check)
        // tells the two apart, matching the Finder/Gmail/Explorer convention.
        'group-data-[state=checked]:bg-task/60 group-data-[state=checked]:border-task/60',
        'group-data-[state=indeterminate]:bg-task/60 group-data-[state=indeterminate]:border-task/60',
        'group-disabled:opacity-50',
        'group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-1',
        visualClassName,
      )}>
        <CheckboxPrimitive.Indicator className="flex w-full h-full items-center justify-center">
          {props.checked === 'indeterminate'
            ? <Minus className="size-[55%] stroke-white fill-none" strokeWidth={3} />
            : <Check className="size-[55%] stroke-white fill-none" strokeWidth={2.5} />}
        </CheckboxPrimitive.Indicator>
      </span>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
