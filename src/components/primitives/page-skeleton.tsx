import { Skeleton } from '../ui/skeleton'

/**
 * Classes for a skeleton's outermost box: invisible for its first 200 ms, then
 * a short fade-in. Most skeletons are up for one render — a page mounting in
 * the follow-up commit after `useReadyAfterMount`, an already-cached lazy
 * chunk — and flashing one then reads as a reload. Skipping loading
 * indicators for waits shorter than that is the usual UI convention (and what
 * React's own Suspense throttling aims for); a genuinely slow load (the vault
 * on a cold start) still shows it, 200 ms later.
 */
export const SKELETON_REVEAL = 'animate-in fade-in delay-200 fill-mode-both'

/** Generic loading placeholder for lazy-loaded list/calendar routes (day, month, unscheduled tasks, notes). */
export function PageSkeleton() {
  return (
    // px-3.5 matches the screen edge these bars stand in for (AgendaRow's
    // mx-3.5), so the rows don't shift sideways when the real list replaces them.
    <div className={`flex flex-col gap-3 px-3.5 pt-3 pb-8 lg:max-w-3xl lg:mx-auto w-full ${SKELETON_REVEAL}`}>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  )
}
