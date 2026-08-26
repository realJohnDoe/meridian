import type { ReactNode } from 'react'
import { Link, type LinkProps } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * The three shapes every settings screen is built from.
 *
 * A section is a titled group; its rows live inside one bordered surface,
 * separated by hairlines rather than by cards of their own. That is the whole
 * reason Settings no longer needs nested containers: scope is expressed by
 * *which screen you are on*, not by how deeply a control is boxed.
 *
 * These are deliberately not in `components/primitives/` — nothing outside
 * `settings/` renders them, and the placement rule in CLAUDE.md says a
 * first-party primitive used by one feature dir belongs in that feature dir.
 */

export function SettingsSection({ title, description, children, className }: {
  title?:       string
  description?: string
  children:     ReactNode
  className?:   string
}) {
  return (
    <section className={cn('flex flex-col gap-2.5', className)}>
      {(title ?? description) && (
        <div className="flex flex-col gap-0.5 px-1">
          {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      )}
      <div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  )
}

/**
 * A labelled row. `control` sits on the label's line (a select, a toggle, a
 * button); `children` flow full-width underneath it, for controls that need
 * the room — chips, inputs, a grid.
 */
export function SettingsRow({ label, description, control, children, className }: {
  label:        string
  description?: ReactNode
  control?:     ReactNode
  children?:    ReactNode
  className?:   string
}) {
  return (
    <div className={cn('flex flex-col gap-2 px-4 py-3.5', className)}>
      <div className="flex min-h-8 items-center justify-between gap-4">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {description ? <p className="-mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      {children}
    </div>
  )
}

/**
 * A row that navigates. An anchor rather than a button so a settings
 * destination behaves like one — middle-click, open-in-new-tab, and a real
 * URL to link at from elsewhere (which is what let `vaultSettingsRequest`'s
 * module-scoped listener go away).
 *
 * Navigation props are passed straight through to `Link`, so `to`/`params`
 * keep the router's own type checking at each call site.
 */
export function SettingsLinkRow({ icon, label, description, value, badge, ...link }: {
  icon?:        ReactNode
  label:        string
  description?: ReactNode
  /** Right-aligned current value, e.g. the active theme's name. */
  value?:       ReactNode
  /** Sits beside the label — a status pill, not a value. */
  badge?:       ReactNode
} & LinkProps) {
  return (
    <Link
      {...link}
      className="flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      {icon}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
          {badge}
        </div>
        {description ? <span className="truncate text-xs text-muted-foreground">{description}</span> : null}
      </div>
      {value ? <span className="shrink-0 text-xs text-muted-foreground">{value}</span> : null}
      <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-muted-foreground" />
    </Link>
  )
}
