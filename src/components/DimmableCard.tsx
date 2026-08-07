import * as React from 'react'
import { cn } from '@/lib/cn'
import { Card } from './ui/card'

interface DimmableCardProps extends React.ComponentProps<typeof Card> {
  /** Applies the done/past dim treatment: overflow clip + `--done-overlay` scrim. */
  dimmed?: boolean
}

function DimmableCard({ dimmed, className, children, ...props }: DimmableCardProps) {
  return (
    <Card
      className={cn(
        'relative bg-card border border-input rounded-lg transition-colors hover:bg-accent',
        // Card's own base className always sets shadow-sm (see ui/card.tsx),
        // so removing the shadow when dimmed needs an explicit shadow-none —
        // tailwind-merge only overrides a utility that's actually present in
        // the merged class list, omitting shadow-sm here wouldn't cancel it.
        // --shadow-card (not shadow-sm) because Tailwind's default shadow-sm
        // (black at .1 opacity) is nearly invisible against these dark
        // surfaces — see the token's definition in index.css. Must use the
        // shadow-(--foo) custom-property shorthand, not shadow-[var(--foo)]:
        // tailwind-merge doesn't classify the bracket form as a shadow value,
        // so it wouldn't drop Card's own shadow-sm and both would ship,
        // leaving shadow-sm to win in the generated CSS.
        dimmed ? 'overflow-hidden shadow-none' : 'shadow-(--shadow-card)',
        className,
      )}
      {...props}
    >
      {dimmed && (
        <div
          className="absolute inset-0 pointer-events-none z-10 rounded-lg"
          style={{ background: 'var(--done-overlay)' }}
        />
      )}
      {children}
    </Card>
  )
}

export { DimmableCard }
