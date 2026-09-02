import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 border font-medium whitespace-nowrap transition-colors',
  {
    variants: {
      variant: {
        // Small display label — replaces .otag and .etag
        tag: 'px-1.5 py-0.5 text-2xs rounded-lg border-[var(--chip-border)] bg-secondary text-secondary-foreground',
        // Wikilink / topic chip — always primary (indigo); underline only when interactive (applied via className).
        // bg-primary/15 (a tint, not a solid fill) reads as an accent rather than a
        // dominant block; text-chip-tint-foreground (not text-primary) is what makes
        // that safe — see the token's doc comment in index.css. A same-hue text color
        // on this tint is what made the original yellow "Low" priority chip unreadable.
        link: 'px-1.5 py-0.5 text-2xs rounded-lg border-[var(--chip-border)] bg-primary/15 text-chip-tint-foreground',
        // Interactive toggle chip — replaces .fchip and .pchip
        // Active state driven by aria-pressed; domain colors via className override
        // (see PRIORITY_CLASS/TYPE_CHIP_ACTIVE_CLS). Same tint + chip-tint-foreground
        // pattern as the `link` variant above.
        chip: [
          'h-control px-2.5 text-xs rounded-full border border-border/50 bg-secondary text-secondary-foreground cursor-pointer',
          'aria-[pressed=true]:bg-primary/15 aria-[pressed=true]:text-chip-tint-foreground aria-[pressed=true]:border-primary',
          'data-[state=on]:bg-primary/15 data-[state=on]:text-chip-tint-foreground data-[state=on]:border-primary',
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
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
