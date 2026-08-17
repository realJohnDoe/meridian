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
    // px-3.5 matches both AgendaRow's mx-3.5 and AgendaHeaderRow's own
    // px-3.5, so the real agenda lands on the same edge the skeleton drew —
    // no sideways jump when it swaps in.
    <div className="flex flex-col gap-0 px-3.5 pt-3 pb-8 lg:max-w-3xl lg:mx-auto">
      {[0, 1, 2].map(i => (
        <div key={i} className="mb-5">
          <Skeleton className="h-4 w-28 mb-3" />
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
  const onOpen = useOpenEntry()

  // Skeleton until the cache-first paint is *complete*, not until the first
  // vault's rows show up.
  //
  // This used to be `vaultLoading && items.length === 0`, which mounts the
  // agenda the moment any one vault hydrates. With several vaults that is
  // mid-way through restoreVaults' phase-1 loop: the agenda seeds its scroll
  // position from a partial row list (see computeAgendaScrollRestore), and the
  // remaining vaults then insert rows above the viewport, shifting the day on
  // screen. A lone GitHub vault never showed it because there was no second
  // layer to land.
  //
  // `vaultLoading` is only ever true during startup (set at store creation,
  // cleared by restoreVaults' own finally), so this cannot stall a later
  // navigation. Phase 1 is indexed Dexie reads with no network, and the
  // background sync still refines the agenda in place afterwards — so the
  // cost is a few milliseconds against a first frame that is actually right.
  if (vaultLoading) {
    return (
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <AgendaSkeleton />
      </div>
    )
  }

  return <AgendaView onOpen={onOpen} />
}
