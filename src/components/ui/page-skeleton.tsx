import { Skeleton } from './skeleton'

/** Generic loading placeholder for lazy-loaded list/calendar routes (day, month, backlog, notes). */
export function PageSkeleton() {
  return (
    // px-3.5 matches the screen edge these bars stand in for (OccurrenceRow's
    // mx-3.5), so the rows don't shift sideways when the real list replaces them.
    <div className="flex flex-col gap-3 px-3.5 pt-3 pb-8 lg:max-w-3xl lg:mx-auto w-full">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  )
}
