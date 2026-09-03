import { useMemo } from 'react'
import { useStore } from '@/store'
import { makeOccPainter, type OccPainter } from '@/occView'

/**
 * The occurrence painter bound to the current color preference and vault list.
 *
 * Called once per view and then per row, rather than once per occurrence:
 * every colored surface (`OccurrencePill`, `TimedBlock`, `OccurrenceCard`'s
 * stripe, the mini-calendar's dots) is rendered from a `.map()` or a plain
 * render function, where a hook cannot go. One subscription per view also
 * beats one per row in a virtualized list.
 *
 * Memoized on the three store values it reads, all of which the store replaces
 * rather than mutates — so the returned painter keeps its identity while they
 * do, and callers can put it straight in a `useMemo`/`useCallback` dep list.
 */
export function useOccPainter(): OccPainter {
  const colorBy        = useStore(s => s.colorBy)
  const vaults         = useStore(s => s.vaults)
  const hiddenVaultIds = useStore(s => s.hiddenVaultIds)
  return useMemo(
    () => makeOccPainter({ colorBy, vaults, hiddenVaultIds }),
    [colorBy, vaults, hiddenVaultIds],
  )
}
