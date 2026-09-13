import { GITHUB_APP_INSTALL_URL, type InstalledRepo } from '@/vaultActions'

// Prefills the name field on GitHub's own new-repository form — verified live
// (2026-09-04): github.com/new honours ?name= across the sign-in redirect.
const NEW_REPO_URL = 'https://github.com/new?name=meridian-vault'

interface RepoPickerProps {
  repos:  InstalledRepo[]
  onPick: (repo: InstalledRepo) => void
}

/**
 * The "which repository backs this vault" list, plus the two out-links that
 * are the only way forward out of an empty one.
 *
 * Shared because a repo choice is reachable two ways and the two must not
 * drift: `auth/callback` renders it after a full sign-in round trip, and the
 * add-vault wizard renders it directly whenever it could reuse an existing
 * session instead of redirecting. Both showed a hand-copied list, explanation
 * and out-links until this existed.
 *
 * An empty list is a normal state, not a dead end — it means the App is
 * installed on nothing this account can reach — so the out-links render either
 * way rather than hiding behind a separate empty screen. What "empty" should
 * be *called* is left to the caller, which has the surrounding heading: the
 * callback screen retitles itself, the wizard keeps its heading and says so
 * in a line above.
 */
export default function RepoPicker({ repos, onPick }: RepoPickerProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      {repos.length > 0 && (
        <div className="flex flex-col gap-2">
          {repos.map(repo => (
            <button
              key={`${repo.owner}/${repo.repo}`}
              type="button"
              onClick={() => { onPick(repo) }}
              className="rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              {repo.owner}/{repo.repo}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Only repositories with Meridian&rsquo;s GitHub App installed appear here.
      </p>
      <div className="flex flex-col gap-1.5 border-t border-border pt-3 text-sm">
        <a
          href={NEW_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Create a new repository on GitHub
        </a>
        <a
          href={GITHUB_APP_INSTALL_URL}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Add another repository&hellip;
        </a>
      </div>
    </div>
  )
}
