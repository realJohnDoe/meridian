import { useState } from 'react'
import { Copy, Check, ExternalLink } from 'lucide-react'
import { Button } from '@/components/primitives/button'
import { APP_URL } from '@/vaultActions'
import { SettingsRow } from './SettingsSection'

/**
 * The message a vault owner sends a collaborator to invite them in.
 *
 * No install step: install is per repo (done already, by the owner), and a
 * collaborator's GitHub sign-in is their whole setup — telling them to
 * install would send them somewhere confusing.
 */
function inviteMessage(owner: string, repo: string): string {
  return `I'm sharing a calendar with you in Meridian — tasks and events as plain Markdown files in a GitHub repo, no plugin needed. Once you're added as a collaborator on ${owner}/${repo}, open ${APP_URL}, sign in with GitHub, and pick that repo.`
}

/** The "Invite someone" row of a GitHub vault. */
export function VaultInviteRow({ owner, repo }: { owner: string, repo: string }) {
  const [inviteCopied, setInviteCopied] = useState(false)

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(inviteMessage(owner, repo))
      setInviteCopied(true)
      setTimeout(() => { setInviteCopied(false) }, 2000)
    } catch {
      // Clipboard access denied or unavailable (non-secure context, some
      // in-app WebViews) — the button just doesn't confirm; nothing else to do.
    }
  }

  return (
    <SettingsRow
      label="Invite someone"
      description="Add them as a collaborator on GitHub, then send them this message — signing in with GitHub is their whole setup."
    >
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-1.5" asChild>
          <a
            href={`https://github.com/${owner}/${repo}/settings/access`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink className="size-3.5 stroke-[1.7]" />
            Add collaborator on GitHub
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => void handleCopyInvite()}
        >
          {inviteCopied ? <Check className="size-3.5 stroke-[1.7]" /> : <Copy className="size-3.5 stroke-[1.7]" />}
          {inviteCopied ? 'Copied' : 'Copy invite message'}
        </Button>
      </div>
    </SettingsRow>
  )
}
