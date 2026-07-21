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
    <div className="flex flex-col gap-0 px-4 pt-3 pb-8 lg:max-w-3xl lg:mx-auto">
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

  if (vaultLoading) {
    return (
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <AgendaSkeleton />
      </div>
    )
  }

  return <AgendaView onOpen={onOpen} />
}
