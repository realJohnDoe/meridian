/**
 * Notice — the one inline banner: an icon, a message and an optional action,
 * in a `warning` (yellow fill) or `info` (muted outline) tone. Entry banners,
 * dialog warnings and per-option notes all use this, so they cannot drift
 * into separate looks — they had, three ways, before it existed.
 */
import type { LucideIcon } from 'lucide-react'
import { Info, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

const TONE = {
  warning: { icon: TriangleAlert, className: 'bg-warning text-warning-foreground' },
  info:    { icon: Info,          className: 'border border-border bg-muted-subtle text-muted-foreground' },
}

interface NoticeProps {
  tone: keyof typeof TONE
  /** Overrides the tone's default icon. */
  icon?: LucideIcon
  /** Rendered at the end, vertically centred (e.g. an Unarchive button or a link). */
  action?: ReactNode
  className?: string
  children: ReactNode
}

export function Notice(props: NoticeProps) {
  const tone = TONE[props.tone]
  const Icon = props.icon ?? tone.icon
  return (
    <div className={cn('flex items-start gap-2 rounded-lg px-3 py-2 text-xs', tone.className, props.className)}>
      <Icon size={14} className="mt-px shrink-0" />
      <span className="flex-1">{props.children}</span>
      {props.action != null && <span className="shrink-0 self-center">{props.action}</span>}
    </div>
  )
}
