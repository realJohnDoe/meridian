import type { VaultRef } from '@/vaultRef'

/**
 * Vault list handed from the old origin to the new one in the URL fragment
 * (never sent to a server). Non-secret references only — never tokens. Anyone
 * can craft such a link, so `parseHandoff` validates it as untrusted input.
 */
export type HandoffVault =
  | { kind: 'github'; name: string; github: { owner: string; repo: string; branch: string } }
  | { kind: 'ical'; name: string; ical: { url: string } }
  | { kind: 'local'; name: string }

const PARAM = '#reconnect='
const MAX_FRAGMENT = 20_000
const MAX_VAULTS = 50
const PENDING_KEY = 'meridian_pending_reconnect'

const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isHttpUrl = (s: string): boolean => {
  try { return /^https?:$/.test(new URL(s).protocol) } catch { return false }
}

function toFragment(list: HandoffVault[]): string {
  const bytes = new TextEncoder().encode(JSON.stringify(list))
  return PARAM + btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The fragment (including `#`) that carries `vaults` to the new origin. Tokens are never read. */
export function encodeHandoff(vaults: VaultRef[]): string {
  const list: HandoffVault[] = []
  for (const v of vaults) {
    if (v.kind === 'github') list.push({ kind: 'github', name: v.name, github: { ...v.github } })
    else if (v.kind === 'ical') list.push({ kind: 'ical', name: v.name, ical: { url: v.ical.url } })
    else if (v.kind === 'local') list.push({ kind: 'local', name: v.name })
  }
  return toFragment(list)
}

/** `undefined` when the hash isn't a handoff, `null` when it is but is malformed, else the vaults. */
export function parseHandoff(hash: string): HandoffVault[] | null | undefined {
  if (!hash.startsWith(PARAM)) return undefined
  if (hash.length > MAX_FRAGMENT) return null
  try {
    const bin = atob(hash.slice(PARAM.length).replace(/-/g, '+').replace(/_/g, '/'))
    const list: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, c => c.charCodeAt(0))))
    if (!Array.isArray(list) || list.length > MAX_VAULTS) return null
    const out: HandoffVault[] = []
    for (const raw of list as unknown[]) {
      if (!isObj(raw) || !isStr(raw.name)) return null
      const { name } = raw
      if (raw.kind === 'local') out.push({ kind: 'local', name })
      else if (raw.kind === 'ical' && isObj(raw.ical) && isStr(raw.ical.url, 2000) && isHttpUrl(raw.ical.url)) {
        out.push({ kind: 'ical', name, ical: { url: raw.ical.url } })
      } else if (raw.kind === 'github' && isObj(raw.github)) {
        const { owner, repo, branch } = raw.github
        if (!isStr(owner, 100) || !isStr(repo, 100) || !isStr(branch, 255)) return null
        out.push({ kind: 'github', name, github: { owner, repo, branch } })
      } else return null
    }
    return out
  } catch {
    return null
  }
}

/** Whether `v` is already registered (GitHub by repo, calendar by URL, folder by name). */
export function isHandoffPresent(v: HandoffVault, existing: VaultRef[]): boolean {
  return existing.some(e => {
    if (v.kind === 'github') return e.kind === 'github' && e.github.owner === v.github.owner && e.github.repo === v.github.repo
    if (v.kind === 'ical') return e.kind === 'ical' && e.ical.url === v.ical.url
    return e.kind === 'local' && e.name === v.name
  })
}

type GitHubHandoff = Extract<HandoffVault, { kind: 'github' }>

/** GitHub vaults to add once the sign-in redirect lands back; survives it in sessionStorage. */
export function savePendingGitHub(vaults: HandoffVault[]): void {
  try { sessionStorage.setItem(PENDING_KEY, toFragment(vaults.filter(v => v.kind === 'github'))) } catch { /* ignore */ }
}

/** Read and clear the vaults saved by `savePendingGitHub`, re-validated. */
export function takePendingGitHub(): GitHubHandoff[] {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY)
    sessionStorage.removeItem(PENDING_KEY)
    return (raw ? parseHandoff(raw) ?? [] : []).filter((v): v is GitHubHandoff => v.kind === 'github')
  } catch { return [] }
}
