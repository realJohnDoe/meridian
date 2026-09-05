import { Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/components/primitives/button'

interface Props {
  Icon:  LucideIcon
  title: string
  hint:  string
  /**
   * True when the view has content that the view filter is hiding — the plain
   * "nothing here" copy would be a lie, so we say so and offer the way out.
   * The filter lives in the topbar, which is a different corner of the screen
   * from the empty list, hence the inline clear button.
   */
  filtered: boolean
}

export default function ListEmptyState({ Icon, title, hint, filtered }: Props) {
  const clearViewFilter = useStore(s => s.clearViewFilter)

  if (filtered) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 pt-24 text-center text-muted-foreground">
        <Users size={32} strokeWidth={1.5} className="opacity-60" />
        <p className="text-base text-foreground">Nothing matches this filter</p>
        <p className="text-sm">Everything here is hidden by the calendar and people filter.</p>
        <Button variant="outline" size="sm" className="mt-1" onClick={clearViewFilter}>
          Clear filter
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 pt-24 text-center text-muted-foreground">
      <Icon size={32} strokeWidth={1.5} className="opacity-60" />
      <p className="text-base text-foreground">{title}</p>
      <p className="text-sm">{hint}</p>
    </div>
  )
}
