import { useState } from 'react'

/**
 * Runs `sync` synchronously during render whenever any value in `deps`
 * changes from its previously rendered value — the React-docs pattern for
 * "adjusting state when a prop changes" without an Effect. Prefer this over
 * `useEffect(sync, deps)` when `sync` only calls setState: an Effect version
 * causes an extra committed render before the corrected state appears,
 * while this fires within the same render pass.
 */
export function useResetOnChange(deps: readonly unknown[], sync: () => void): void {
  const [prevDeps, setPrevDeps] = useState<readonly unknown[]>(deps)
  const changed = deps.length !== prevDeps.length || deps.some((d, i) => !Object.is(d, prevDeps[i]))
  if (changed) {
    setPrevDeps(deps)
    sync()
  }
}
