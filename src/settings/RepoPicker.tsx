import type { ReactNode } from 'react'
import { Check, ChevronRight, ExternalLink } from 'lucide-react'
import { SettingsSection } from './SettingsSection'
import { useStore } from '@/store'
import { GITHUB_APP_INSTALL_URL, type InstalledRepo } from '@/vaultActions'
import { cn } from '@/lib/cn'

// Prefills the name field on GitHub's own new-repository form — verified live
// (2026-09-04): github.com/new honours ?name= across the sign-in redirect.
const NEW_REPO_URL = 'https://github.com/new?name=meridian-vault'

/**
 * A settings row that leaves the app. `SettingsLinkRow` is a TanStack `Link`
 * and so can only address internal routes; these go to github.com. Kept here
 * rather than beside its siblings because this screen is the only caller —
 * the placement rule in CLAUDE.md puts a one-consumer primitive with its
 * consumer.
 */
function ExternalRow({ href, label, description }: { href: string; label: string; description?: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-medium text-foreground">{label}</span>
        {description ? <span className="truncate text-xs text-muted-foreground">{description}</span> : null}
      </div>
      <ExternalLink className="size-4 shrink-0 stroke-[1.7] text-muted-foreground" />
    </a>
  )
}

interface RepoPickerProps {
  repos:  InstalledRepo[]
  onPick: (repo: InstalledRepo) => void
  /**
   * Offered as a row alongside the out-links when the caller has a sign-in to
   * restart. The callback screen has just completed one and passes nothing.
   */
  onSignInAgain?: () => void
}

/**
 * The "which repository backs this vault" list, plus the ways out of a list
 * that doesn't have the repo you wanted in it.
 *
 * Shared because a repo choice is reachable two ways and the two must not
 * drift: `auth/callback` renders it after a full sign-in round trip, and the
 * add-vault wizard renders it directly whenever it could reuse an existing
 * session instead of redirecting.
 *
 * Lives in `settings/` rather than `components/` so it can be built from the
 * same `SettingsSection` rows every other settings screen uses — `components/`
 * may not import a feature module, and hand-copying the surface styling there
 * is how it drifts. `routes/auth.callback` reaches it through the barrel, the
 * same way the settings routes reach their screens.
 *
 * An empty list is a normal state, not a dead end — it means the App is
 * installed on nothing this account can reach — so the out-links render either
 * way. What "empty" should be *called* is left to the caller, which owns the
 * surrounding heading.
 */
export default function RepoPicker({ repos, onPick, onSignInAgain }: RepoPickerProps) {
  // Repos already backing a vault, so the list can show them as taken rather
  // than inviting a second vault onto the same repository. GitHub treats
  // owner/repo case-insensitively, so the comparison does too.
  const vaults = useStore(s => s.vaults)
  const alreadyAdded = new Set(
    vaults.filter(v => v.kind === 'github').map(v => `${v.github.owner}/${v.github.repo}`.toLowerCase()),
  )

  return (
    <div className="flex flex-col gap-5">
      {repos.length > 0 && (
        <SettingsSection description="Only repositories with Meridian's GitHub App installed appear here.">
          {repos.map(repo => {
            const slug  = `${repo.owner}/${repo.repo}`
            const taken = alreadyAdded.has(slug.toLowerCase())
            return (
              <button
                key={slug}
                type="button"
                disabled={taken}
                onClick={() => { onPick(repo) }}
                className={cn(
                  'flex items-center gap-3 px-4 py-3.5 text-left transition-colors',
                  taken
                    ? 'cursor-default'
                    : 'hover:bg-accent focus-visible:bg-accent focus-visible:outline-none',
                )}
              >
                <span className={cn(
                  'min-w-0 flex-1 truncate text-sm font-medium',
                  taken ? 'text-muted-foreground' : 'text-foreground',
                )}>
                  {slug}
                </span>
                {taken
                  ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <Check className="size-3.5 stroke-[1.7]" />
                      Added
                    </span>
                  )
                  : <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-muted-foreground" />}
              </button>
            )
          })}
        </SettingsSection>
      )}

      <SettingsSection>
        <ExternalRow
          href={NEW_REPO_URL}
          label="Create a new repository on GitHub"
          description="A new, empty repository works — it doesn't need a README."
        />
        <ExternalRow
          href={GITHUB_APP_INSTALL_URL}
          label="Add another repository"
          description="Grant Meridian's GitHub App access to more of your repositories."
        />
        {onSignInAgain && (
          <button
            type="button"
            onClick={onSignInAgain}
            className="flex items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm font-medium text-foreground">Sign in with a different account</span>
              <span className="truncate text-xs text-muted-foreground">Connect a repository from another GitHub account.</span>
            </div>
            <ChevronRight className="size-4 shrink-0 stroke-[1.7] text-muted-foreground" />
          </button>
        )}
      </SettingsSection>
    </div>
  )
}
