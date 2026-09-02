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
        // Solid bg + -foreground ink, not a tint: a light tint behind same-hue text can't
        // clear AA on either light or dark themes (see the `chip` variant below).
        link: 'px-1.5 py-0.5 text-2xs rounded-lg border-[var(--chip-border)] bg-primary text-primary-foreground',
        // Interactive toggle chip — replaces .fchip and .pchip
        // Active state driven by aria-pressed; priority colors via inline style override.
        // Solid bg + -foreground ink (not a tint) for the same reason as
        // dvBlockVariants (see occurrence-variants.ts): a light tint behind
        // colored text can't clear AA on light *or* dark themes.
        chip: [
          'h-control px-2.5 text-xs rounded-full border border-border/50 bg-secondary text-secondary-foreground cursor-pointer',
          'aria-[pressed=true]:bg-primary aria-[pressed=true]:text-primary-foreground aria-[pressed=true]:border-primary',
          'data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:border-primary',
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
