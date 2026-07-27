import { createFileRoute } from '@tanstack/react-router'
import { AgendaView } from '@/calendar'
import { useOpenEntry } from '@/hooks'
import { useStore } from '@/store'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_app/')({
  component: AgendaPage,
})

function AgendaSkeleton() {
  return (
    // px-2 matches OccurrenceRow's mx-2 and the header bars are nudged the
    // further 6px to AgendaHeaderRow's px-3.5, so the real agenda lands on the
    // same two edges the skeleton drew — no sideways jump when it swaps in.
    <div className="flex flex-col gap-0 px-2 pt-3 pb-8 lg:max-w-3xl lg:mx-auto">
      {[0, 1, 2].map(i => (
        <div key={i} className="mb-5">
          <Skeleton className="h-4 w-28 mb-3 ml-1.5" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            {i === 0 && <Skeleton className="h-10 w-full rounded-xl" />}
          </div>
        </div>
      ))}
    </div>
  )
}

function AgendaPage() {
  const vaultLoading = useStore(s => s.vaultLoading)
  const items = useStore(s => s.items)
  const onOpen = useOpenEntry()

  // Skeleton only when there is genuinely nothing to show. Once the cache has
  // painted, the agenda renders immediately and the background sync refines it
  // in place — matching the entry route's `vaultLoading && !occ` guard.
  if (vaultLoading && items.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <AgendaSkeleton />
      </div>
    )
  }

  return <AgendaView onOpen={onOpen} />
}
