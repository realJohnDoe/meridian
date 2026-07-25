import * as React from 'react'
import { cn } from '@/lib/cn'
import { Card } from './card'

interface DimmableCardProps extends React.ComponentProps<typeof Card> {
  /** Applies the done/past dim treatment: overflow clip + `--done-overlay` scrim. */
  dimmed?: boolean
}

function DimmableCard({ dimmed, className, children, ...props }: DimmableCardProps) {
  return (
    <Card
      className={cn(
        'relative shadow-none bg-card border border-input rounded-lg transition-colors hover:bg-accent',
        dimmed && 'overflow-hidden',
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
