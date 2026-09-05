/**
 * Button — a memo-friendly wrapper over `components/ui/button`.
 *
 * `components/ui/button.tsx` defaults `asChild` via a destructured parameter
 * (`asChild = false`). That shape (an AssignmentPattern inside a destructured
 * parameter) makes babel-plugin-react-compiler bail out of optimizing the
 * whole component, silently — no build or lint error, just no memoization.
 * See OccurrenceCard.tsx for the full rationale.
 *
 * `components/ui/` is a faithful shadcn mirror (CLAUDE.md; only the shadcn
 * CLI writes there), so patching `button.tsx` directly would make `shadcn
 * diff` report a permanent divergence. This wrapper is a plain pass-through
 * with no destructured defaults of its own, so it compiles cleanly — use it
 * instead of importing `components/ui/button` directly wherever a component
 * needs to be memoizable.
 */
import { Button as ShadcnButton, buttonVariants } from '../ui/button'
import type { ButtonProps } from '../ui/button'

function Button(props: ButtonProps) {
  return <ShadcnButton {...props} />
}

export { Button, buttonVariants }
export type { ButtonProps }
