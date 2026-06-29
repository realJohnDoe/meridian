import { useEffect, useLayoutEffect, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AgendaView } from '@/calendar'
import { useOpenEntry } from '@/hooks'
import { useStore } from '@/store'
import { onVaultChanged } from '@/storage'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_app/')({
  component: AgendaPage,
})

// Survives remounts so navigating back (e.g. from the entry editor) lands where we left off.
let savedScrollTop = 0

function AgendaSkeleton() {
  return (
    <div className="flex flex-col gap-0 px-4 pt-3 pb-8 lg:max-w-[720px] lg:mx-auto">
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
  const scRef = useRef<HTMLDivElement>(null)

  // When a vault activates, scroll to today once data arrives. AgendaView owns
  // the virtualizer and performs the actual scroll when this flag is set.
  useEffect(() => onVaultChanged(() => useStore.setState({ scrollToTodayOnce: true })), [])

  // Restore saved scroll before paint (no blink); save on unmount. The virtualizer
  // reports the full scroll height from estimates immediately, so the saved scrollTop
  // lands correctly. Cleanup reads scRef.current at unmount time (not a captured el)
  // because the skeleton renders first — scRef is null at mount and a captured el
  // would be null forever, so the position would never be saved.
  useLayoutEffect(() => {
    const el = scRef.current
    if (el && !useStore.getState().scrollToTodayOnce) el.scrollTop = savedScrollTop
    return () => { savedScrollTop = scRef.current?.scrollTop ?? savedScrollTop }
  }, [])

  const onOpen = useOpenEntry()

  if (vaultLoading) {
    return (
      <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]">
        <AgendaSkeleton />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]" id="agSc" ref={scRef}>
      <AgendaView onOpen={onOpen} scrollRef={scRef} initialScrollOffset={savedScrollTop} />
    </div>
  )
}
