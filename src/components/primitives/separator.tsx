/**
 * Separator — a memo-friendly wrapper over `components/ui/separator`.
 *
 * `components/ui/separator.tsx` defaults `orientation`/`decorative` via
 * destructured parameters, which makes babel-plugin-react-compiler bail out
 * of optimizing the whole component, silently — no build or lint error, just
 * no memoization. See OccurrenceCard.tsx for the full rationale.
 *
 * `components/ui/` is a faithful shadcn mirror (CLAUDE.md; only the shadcn
 * CLI writes there), so patching `separator.tsx` directly would make `shadcn
 * diff` report a permanent divergence. This wrapper is a plain pass-through
 * with no destructured defaults of its own, so it compiles cleanly — use it
 * instead of importing `components/ui/separator` directly wherever a
 * component needs to be memoizable.
 */
import type * as React from 'react'
import { Separator as ShadcnSeparator } from '../ui/separator'

type SeparatorProps = React.ComponentProps<typeof ShadcnSeparator>

function Separator(props: SeparatorProps) {
  return <ShadcnSeparator {...props} />
}

export { Separator }
export type { SeparatorProps }
