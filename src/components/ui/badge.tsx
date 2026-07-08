import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-[5px] border font-medium whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        // Small display label — replaces .otag and .etag
        tag: 'px-1.5 py-0.5 text-[10px] rounded-lg border-[var(--chip-border)] bg-secondary text-muted-foreground',
        // Wikilink / topic chip — always indigo; underline only when interactive (applied via className)
        link: 'px-1.5 py-0.5 text-[10px] rounded-lg border-[var(--chip-border)] bg-indigo-500/15 text-indigo-400',
        // Interactive toggle chip — replaces .fchip and .pchip
        // Active state driven by aria-pressed; priority colors via inline style override
        chip: [
          'h-control px-2.5 text-xs rounded-full border border-border/50 bg-secondary text-secondary-foreground cursor-pointer',
          'aria-[pressed=true]:bg-primary/20 aria-[pressed=true]:text-primary aria-[pressed=true]:border-primary',
          'data-[state=on]:bg-primary/20 data-[state=on]:text-primary data-[state=on]:border-primary',
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
