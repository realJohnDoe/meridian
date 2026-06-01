import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-[5px] border font-medium whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        // Small display label — replaces .otag and .etag
        tag: 'px-1.5 py-0.5 text-[10px] rounded-lg border-transparent bg-secondary text-muted-foreground',
        // Interactive toggle chip — replaces .fchip and .pchip
        // Active state driven by aria-pressed; priority colors via inline style override
        chip: [
          'px-3 py-1.5 text-xs rounded-full border border-border/50 bg-secondary text-secondary-foreground cursor-pointer',
          'aria-[pressed=true]:bg-[var(--ab2)] aria-[pressed=true]:text-primary aria-[pressed=true]:border-primary',
        ],
      },
    },
    defaultVariants: { variant: 'tag' },
  },
)

interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
