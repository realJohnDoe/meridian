import type { StorageBackend, RawFile, PermissionOutcome } from './backend'
import type { VaultKind } from '@/vaultRef'
import { icsToEntries, shortHash, type SynthesizedEntry } from './ical/icsToEntries'
import { WORKER_ORIGIN } from './workerOrigin'

/**
 * A calendar subscription, as an ordinary storage backend.
 *
 * With the multi-vault foundation in place this needs no special case anywhere:
 * it synthesizes virtual `.md` files exactly as `exampleBackend.ts` does, and
 * they ride the whole existing pipeline — `parseToStoreItems` → expansion →
 * agenda → search → backlinks. Refreshing is literally
 * `runSync(vaultId, { pull: true })`, so there is no subscription refresh loop
 * of its own.
 */

/** How long a fetched feed is reused without going back to the network. */
const MEMO_MS = 30_000

/** A feed the browser cannot read directly goes through Meridian's Worker. */
function proxyUrl(feedUrl: string): string {
  return `${WORKER_ORIGIN}/ical?url=${encodeURIComponent(feedUrl)}`
}

/** The Worker's JSON error body, when it sent one. */
async function errorDescription(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error_description' in body) {
      const { error_description: description } = body
      if (typeof description === 'string') return description
    }
  } catch { /* not JSON — fall through */ }
  return `Calendar server returned ${response.status}`
}

/** Raised by the wizard's validation step so it can show the Worker's own message. */
export class IcalFetchError extends Error {}

/**
 * Fetch and synthesize a feed once, without registering anything.
 *
 * The wizard's validate-and-preview step calls this so it can show the calendar
 * name and event count *before* the vault is created — which is also the only
 * point where a typo'd URL is cheap to correct.
 */
export async function previewIcalFeed(feedUrl: string): Promise<{ name?: string; eventCount: number }> {
  const response = await fetch(proxyUrl(feedUrl))
  if (!response.ok) throw new IcalFetchError(await errorDescription(response))

  const synthesis = icsToEntries(await response.text())
  if (!synthesis) throw new IcalFetchError("That URL didn't return a calendar. Check you copied the iCal/ICS address rather than the calendar's web page.")
  return { ...(synthesis.calendarName ? { name: synthesis.calendarName } : {}), eventCount: synthesis.entries.length }
}

interface FeedSnapshot {
  entries:   SynthesizedEntry[]
  etag:      string | null
  fetchedAt: number
}

export class IcalBackend implements StorageBackend {
  readonly kind: VaultKind = 'ical'
  /** Nothing to push: the feed has no writable side at all. */
  readonly readOnly = true
  /** Unlike the Tutorial vault, there IS a remote here — so the scheduler polls it. */
  readonly hasRemote = true

  private snapshot: FeedSnapshot | null = null
  /** Dedupes the statAll + readFiles pair a single sync cycle makes. */
  private inflight: Promise<FeedSnapshot> | null = null

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly feedUrl: string,
  ) {}

  /**
   * The feed, fetched at most once per cycle.
   *
   * `force` distinguishes the two callers. `statAll` starts a cycle and must ask
   * the server whether anything changed; `readFiles`/`readAll` follow within the
   * same cycle and must see exactly what `statAll` just listed — refetching there
   * could hand back content whose hashes no longer match the versions just
   * reported, and reconcile would record a version for content it never stored.
   *
   * The conditional request is what makes the 15-minute poll nearly free: an
   * unchanged feed answers 304 with no body, and the previous synthesis is kept
   * — which also means the entries keep byte-identical content and reconcile
   * sees no change.
   */
  private async load(force: boolean): Promise<FeedSnapshot> {
    const cached = this.snapshot
    if (!force && cached && Date.now() - cached.fetchedAt < MEMO_MS) return cached
    if (this.inflight) return this.inflight

    this.inflight = (async () => {
      try {
        const headers: HeadersInit = cached?.etag ? { 'If-None-Match': cached.etag } : {}
        const response = await fetch(proxyUrl(this.feedUrl), { headers })

        if (response.status === 304 && cached) {
          const kept: FeedSnapshot = { ...cached, fetchedAt: Date.now() }
          this.snapshot = kept
          return kept
        }
        if (!response.ok) throw new Error(await errorDescription(response))

        const synthesis = icsToEntries(await response.text())
        if (!synthesis) throw new Error(`"${this.name}" did not return a calendar.`)

        const next: FeedSnapshot = {
          entries: synthesis.entries,
          etag: response.headers.get('ETag'),
          fetchedAt: Date.now(),
        }
        this.snapshot = next
        return next
      } finally {
        this.inflight = null
      }
    })()
    return this.inflight
  }

  private static path(entry: SynthesizedEntry): string {
    return `${entry.fileSlug}.md`
  }

  /**
   * Per-path version tokens, which reconcile needs but a feed cannot supply: it
   * has one ETag for the whole document, not one per event. A content hash gives
   * each entry its own token, so an unchanged event keeps its version even when
   * the feed as a whole changed — and only the events that genuinely differ are
   * re-parsed and re-rendered.
   */
  async statAll(): Promise<Map<string, string>> {
    const { entries } = await this.load(true)
    return new Map(entries.map(e => [IcalBackend.path(e), shortHash(e.content)]))
  }

  async readFiles(paths: string[]): Promise<RawFile[]> {
    const wanted = new Set(paths)
    const { entries } = await this.load(false)
    return entries
      .filter(e => wanted.has(IcalBackend.path(e)))
      .map(e => ({ path: IcalBackend.path(e), content: e.content, version: shortHash(e.content) }))
  }

  async readAll(): Promise<RawFile[]> {
    const { entries } = await this.load(false)
    return entries.map(e => ({ path: IcalBackend.path(e), content: e.content, version: shortHash(e.content) }))
  }

  // Writes never reach here — `writeEntityToCache` and `deleteFromBackend`
  // refuse a read-only backend, and PR 4's view-only editor offers no save at
  // all. Throwing rather than silently succeeding is deliberate: a silent no-op
  // would mean a future caller that forgot the check believes it saved.
  write(): Promise<string | undefined> {
    return Promise.reject(new Error(`"${this.name}" is a calendar subscription and cannot be edited.`))
  }

  delete(): Promise<void> {
    return Promise.reject(new Error(`"${this.name}" is a calendar subscription and cannot be edited.`))
  }

  /**
   * There is no permission to grant — a feed URL either fetches or it doesn't.
   * A failed fetch is reported as `'unreachable'` rather than `'denied'`, so the
   * restore path mounts the vault anyway and its cached events stay on screen
   * while the network is down.
   */
  async ensurePermission(_interactive: boolean): Promise<PermissionOutcome> {
    try {
      await this.load(true)
      return 'granted'
    } catch {
      return 'unreachable'
    }
  }
}
