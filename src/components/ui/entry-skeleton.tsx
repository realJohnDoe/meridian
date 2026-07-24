import { Skeleton } from './skeleton'

export function EntrySkeleton() {
  return (
    <div className="flex-1 flex flex-col gap-3 px-3.5 pt-5 lg:max-w-3xl lg:mx-auto w-full">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
}
