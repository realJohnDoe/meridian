import type { ReactNode } from 'react'
import { Code2, Scale, Bug, ExternalLink } from 'lucide-react'
import { SettingsSection, SettingsRow } from './SettingsSection'

const REPO_URL    = 'https://github.com/realJohnDoe/meridian'
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`
const ISSUES_URL  = `${REPO_URL}/issues`

/**
 * A settings row that leaves the app. `SettingsLinkRow` is a TanStack `Link`
 * and so can only address internal routes (see RepoPicker.tsx's identical
 * note) — these go to github.com, so a plain anchor is used instead.
 */
function AboutLinkRow({ icon, label, value, href }: {
  icon:  ReactNode
  label: string
  value?: string
  href:  string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      {icon}
      <span className="flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      {value && <span className="shrink-0 text-xs text-muted-foreground">{value}</span>}
      <ExternalLink className="size-4 shrink-0 stroke-[1.7] text-muted-foreground" />
    </a>
  )
}

/**
 * The project's only route back to itself: what an installed, chrome-less PWA
 * is, where its source lives, and where to send feedback. No telemetry, no
 * in-app form — links only. See #1084.
 */
export default function AboutSettings() {
  return (
    <SettingsSection title="About">
      <SettingsRow label="Meridian" control={<span className="text-xs text-muted-foreground">{__APP_VERSION__}</span>} />
      <AboutLinkRow
        icon={<Code2 className="size-4.5 shrink-0 stroke-[1.7] text-muted-foreground" />}
        label="Source code"
        href={REPO_URL}
      />
      <AboutLinkRow
        icon={<Scale className="size-4.5 shrink-0 stroke-[1.7] text-muted-foreground" />}
        label="License"
        value="MIT"
        href={LICENSE_URL}
      />
      <AboutLinkRow
        icon={<Bug className="size-4.5 shrink-0 stroke-[1.7] text-muted-foreground" />}
        label="Report an issue"
        href={ISSUES_URL}
      />
    </SettingsSection>
  )
}
