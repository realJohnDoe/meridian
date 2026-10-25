import { useMatch } from '@tanstack/react-router'
import type { ViewChrome } from './-viewChrome'

/**
 * Unscheduled Tasks and Notes share one answer to `ViewChrome`: a fixed label and
 * nothing else. All three nulls are load-bearing — between them they are the
 * entire reason these two views get no prev/next chevrons, no Today button,
 * no quick-nav panel (neither the mobile inline card nor the desktop popover)
 * and no swipe-to-toggle gesture, without `_app.tsx` naming either route.
 */
export function useListChrome(): ViewChrome | null {
  const unscheduledMatch = useMatch({ from: '/_app/unscheduled', shouldThrow: false })
  const notesMatch = useMatch({ from: '/_app/notes', shouldThrow: false })

  const label = unscheduledMatch ? 'Unscheduled Tasks' : notesMatch ? 'Notes' : null
  if (label === null) return null

  return { kind: 'list', label, paging: null, onToday: null, quickNav: null }
}
