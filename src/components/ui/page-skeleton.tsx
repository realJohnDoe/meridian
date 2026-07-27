import { Skeleton } from './skeleton'

/** Generic loading placeholder for lazy-loaded list/calendar routes (day, month, backlog, notes). */
export function PageSkeleton() {
  return (
    // px-2 = the card edge these bars stand in for (OccurrenceRow's mx-2), so
    // the rows don't shift sideways when the real list replaces them.
    <div className="flex flex-col gap-3 px-2 pt-3 pb-8 lg:max-w-3xl lg:mx-auto w-full">
      <Skeleton className="h-4 w-28 ml-1.5" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  )
}
