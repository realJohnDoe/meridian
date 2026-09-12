/**
 * The six sync invariants, as assertions over the two-client harness (#1021).
 *
 * ## Where the six come from
 *
 * The tooling analysis that opened this line of work counted thirty sync
 * bugfixes and reported that *"all 30 violate one of six sentences"* — but only
 * ever wrote one of the six down (*no acknowledged write is lost*, broken 16
 * times between 11 June and 6 September). Deriving the other five was part of
 * #1021, and `plans/reports/sync-invariants.md` records the full defect-by-defect
 * derivation. What follows is the result, with the defects each sentence was
 * read off from.
 *
 * They divide into two kinds, and the division decides where each is checked:
 *
 * **Four safety properties** — things that must be true at every instant, so
 * they are asserted after *every* step of *every* run:
 *
 *  1. `durability` — **no acknowledged write is lost.** Content the app told
 *     the user was saved stays reachable — at its path, in a conflict copy, or
 *     in some client's cache — until a client that had actually *seen* it acts
 *     to replace or delete it. The 16, and the one this harness was built for:
 *     #114, #119, #386, #481, #516, #520, #529, #827, #977, #981, #1017.
 *  2. `clean-truth` — **a record marked clean is a record the remote agrees
 *     with.** "Clean" is the app's own claim that the backend holds this
 *     content at this version; a clean row whose version the remote never held
 *     that content at is a lost update waiting for its next CAS to pass.
 *     #520 (clean-stamped over a concurrent edit), #529 (the same on the pull
 *     side), #738 (a recorded `undefined` version making the next push a
 *     create).
 *  3. `no-manufactured-conflict` — **a conflict copy means two clients
 *     genuinely diverged.** A duplicate file the user has to clean up by hand
 *     is a real cost, and it must be paid only for a real conflict. #738 (a
 *     copy byte-identical to the original, from a 409 that was a branch-ref
 *     race), #127, #129, #953.
 *  4. `store-cache-coherence` — **what the user is looking at is what a reload
 *     would give them.** The in-memory store and the cache name the same set
 *     of entries for a vault. #119, #486, #570, #977.
 *
 * **Two liveness properties** — things that must *become* true once the world
 * stops moving, so they are asserted whenever the world is settled (and the
 * generated runs end with a settling phase, so every run checks them at least
 * once):
 *
 *  5. `progress` — **no local change is stranded.** A dirty record left after
 *     the world has settled is a write the app accepted and then quietly
 *     stopped trying to deliver. #481 (three separate ways to strand one),
 *     #122, #820.
 *  6. `convergence` — **settled clients agree.** Two devices that have both
 *     synced with nothing left to push hold the same content for every path.
 *     #168 (backend files never pulled), #221 and #516 (an eventually-consistent
 *     listing dropping or reverting a just-pushed file), #92.
 *
 * ## What makes durability checkable
 *
 * The hard half of invariant 1 is not "is the content still there" but "was it
 * allowed to go". A delete is *supposed* to remove content. What separates the
 * legitimate case from #1017 is whether the client doing the removing had ever
 * observed what it removed:
 *
 *   - A deletes a file it pulled → it saw what it was deleting. Fine.
 *   - A deletes a path where B's file happens to sit, which A never read,
 *     never held a version for, and never acknowledged → a lost write. That is
 *     #1017, and it is the same rule `resolveCollision` states for itself
 *     (`sync.ts`, "an edit beats a delete"), read from the other side.
 *
 * So the ledger below tracks two things: which content each client has *held*
 * (observed), and which content is still *owed a home*. A write or delete
 * retires only what its client had observed at that path. Anything still owed
 * must be findable somewhere.
 *
 * Content is identified by a **token** the generator embeds in each write
 * (`k7k`) rather than by byte equality, and that is load-bearing rather than a
 * convenience: `resolveCollision`'s merge branch combines two sides into a file
 * equal to neither, so a byte-equality oracle would report a merge — the one
 * outcome where nothing at all was lost — as a loss. A token survives the
 * merge because the user's words do.
 */
import type { CacheRecord } from '@/storage/cache/files'
import { RECONCILE_DELETE_GRACE_MS } from '@/storage/sync'
import type { FakeGitHub } from './twoClientHarness'

// ── The six ──────────────────────────────────────────────────────────

type InvariantId =
  | 'durability'
  | 'clean-truth'
  | 'no-manufactured-conflict'
  | 'store-cache-coherence'
  | 'progress'
  | 'convergence'

/** One invariant, broken, with enough detail to read the failure without a debugger. */
export interface Violation {
  invariant: InvariantId
  detail: string
  /**
   * How a `durability` loss happened — what actually removed the content.
   *
   * Present so a caller can tell a *filed, open* defect from a new one without
   * matching on prose. `delete` is #1017's shape: a `DELETE` landed on the path,
   * which means some client destroyed a file it had never observed. `overwrite`
   * is anything else, and there is no open issue for it.
   */
  cause?: 'delete' | 'overwrite'
}

/** One client's whole observable state at one instant. */
export interface ClientView {
  id: string
  vaultId: string
  rows: CacheRecord[]
  /** The slugs this client's store layer holds for its vault. */
  storeSlugs: Set<string>
  /**
   * Slugs this client wrote **at the storage seam**, which in the running app
   * the committing layer would have put in the store first.
   *
   * The harness drives `writeEntityToCache` directly — that is the spike's
   * central finding, and what makes a scenario able to state an edit as an
   * edit — but the store update for a *local* write happens one layer up, in
   * `storeCommit.commitNext`, and `markPushed` never puts it there either. So
   * a locally-written path is legitimately absent from its own client's store
   * here, and stays exempt from the cache-to-store direction below until the
   * storage layer is seen to have put it in the store itself. From that point
   * on it is checked like any other: a path the store *had* and lost while the
   * cache kept it is #516's failure exactly.
   */
  seamOnlySlugs: Set<string>
  /**
   * The same exemption, mirrored for deletes.
   *
   * `deleteFromBackend` stages a tombstone in the cache; the *store* eviction is
   * `storeCommit.commitDelete`'s, one layer up. So a slug this client deleted at
   * the seam legitimately lingers in its own store until the storage layer
   * itself evicts it — at which point the exemption is spent and the slug is
   * held to the store-to-cache direction like any other.
   */
  seamDeletedSlugs: Set<string>
}

/** Everything the assertions can see: the one remote, and every client. */
export interface WorldView {
  remote: FakeGitHub
  clients: ClientView[]
}

// ── Tokens ───────────────────────────────────────────────────────────

/**
 * The marker a generated write embeds in its content. Delimited on both sides
 * so `k3k` is never a substring of `k31k` — a bare `k3` prefix would make the
 * durability check silently pass on the wrong file.
 */
const TOKEN_RE = /k\d+k/g

export function tokenFor(step: number): string { return `k${String(step)}k` }

function tokensIn(content: string): Set<string> {
  return new Set(content.match(TOKEN_RE) ?? [])
}

// ── The ledger ───────────────────────────────────────────────────────

/** The two halves of a generated entry — see `nextContent` in `interleavings.ts`. */
export type Field = 'title' | 'body'

interface OwedWrite {
  path:   string
  /**
   * Which half of the entry this write is owed for.
   *
   * Owing per *field* rather than per file is what keeps the oracle both sound
   * and sharp. Two clients can each supersede a different half of the same
   * earlier write — one retitles while the other rewrites the body — and the
   * merged result then contains neither of the original's tokens while having
   * lost nothing at all. Owing per file reports that as a loss. Owing per file
   * *and* forgiving anything the new content carried forward stops the false
   * positive but opens a real hole: a title edit would then retire the body
   * token it left untouched, and a later write that dropped that body would go
   * unnoticed. Per field has neither problem.
   */
  field:  Field
  token:  string
  /** The client whose user typed it — who a conflict copy would belong to. */
  origin: string
  step:   number
}

/**
 * The model the durability assertion is checked against: what has been
 * acknowledged, who has seen what, and what is still owed a home.
 *
 * Deliberately *observational* rather than predictive — it never says what the
 * storage layer should do next, only what the user has been promised. A model
 * that predicted outcomes would have to reimplement `resolveCollision`, which
 * is a trap a hand-written CAS harness fell into once already (removed in
 * #1038 for testing a copy of `pushDirty` rather than `pushDirty` itself).
 */
export class Ledger {
  private _owed: OwedWrite[] = []
  /** `${clientId} ${path}` -> every token that client has held there. */
  private _observed = new Map<string, Set<string>>()

  private _key(clientId: string, path: string): string { return `${clientId} ${path}` }

  private _seen(clientId: string, path: string): Set<string> {
    return this._observed.get(this._key(clientId, path)) ?? new Set()
  }

  /**
   * A write the app has accepted — it is in Dexie, and the UI says saved.
   *
   * `fields` is which halves of the entry this write set: one for an ordinary
   * edit, both for a file created from nothing. Each of them supersedes what
   * this client had already observed *in that half*, and nothing else — a
   * client only consents to replacing what it has seen.
   */
  noteWrite(clientId: string, path: string, fields: readonly Field[], token: string, step: number): void {
    const seen = this._seen(clientId, path)
    for (const field of fields) {
      this._owed = this._owed.filter(o => !(o.path === path && o.field === field && seen.has(o.token)))
      this._owed.push({ path, field, token, origin: clientId, step })
    }
    this._origins.set(token, clientId)
  }

  /**
   * A delete the app has accepted. Retires everything this client had observed
   * at the path — and nothing else, which is the whole of #1017: a client
   * cannot consent to destroying a file it has never seen.
   */
  noteDelete(clientId: string, path: string): void {
    // A delete is about the whole file, so every field goes at once.
    const seen = this._seen(clientId, path)
    this._owed = this._owed.filter(o => !(o.path === path && seen.has(o.token)))
  }

  /** Harvest what every client is holding right now — its cache row *is* what it has seen. */
  observe(world: WorldView): void {
    for (const c of world.clients) {
      for (const row of c.rows) {
        if (row.status === 'deleted') continue
        const key = this._key(c.id, row.path)
        let set = this._observed.get(key)
        if (!set) { set = new Set(); this._observed.set(key, set) }
        for (const t of tokensIn(row.content)) set.add(t)
        // `baseContent` is the ancestor an edit was made from: this client
        // pulled it at some point, so it has seen it just as surely.
        if (row.baseContent) for (const t of tokensIn(row.baseContent)) set.add(t)
      }
    }
  }

  /**
   * Which client wrote a given token. Kept for every token ever written, not
   * just the owed ones — a conflict copy has to be attributable long after the
   * write in it was superseded.
   */
  originOf(token: string): string | undefined { return this._origins.get(token) }

  private _origins = new Map<string, string>()

  owed(): readonly OwedWrite[] { return this._owed }

  /**
   * Conflict copies already judged, so each is judged exactly once — at the
   * step it appears.
   *
   * The verdict has to be taken then and not later: a copy is legitimate
   * relative to what sat at its base path *at the moment it was written*, and
   * that file can be edited or deleted afterwards by either device. Re-judging
   * an old copy against a base that has since been deleted attributes it to
   * one writer and calls a real conflict manufactured.
   */
  readonly judgedCopies = new Set<string>()
}

// ── Invariant 1: durability ──────────────────────────────────────────

/** Everywhere content can legitimately still be found. */
function reachableTokens(world: WorldView): Set<string> {
  const found = new Set<string>()
  for (const path of world.remote.paths()) {
    for (const t of tokensIn(world.remote.get(path)?.content ?? '')) found.add(t)
  }
  // A dirty row is not yet on the remote, but it is in the user's vault and
  // still queued to go — not lost, merely not delivered. `progress` is the
  // invariant that says it must eventually leave.
  for (const c of world.clients) {
    for (const row of c.rows) {
      if (row.status === 'deleted') continue
      for (const t of tokensIn(row.content)) found.add(t)
    }
  }
  return found
}

function checkDurability(world: WorldView, ledger: Ledger): Violation | null {
  const found = reachableTokens(world)
  const lost = ledger.owed().filter(o => !found.has(o.token))
  if (lost.length === 0) return null
  const l = lost[0]
  if (!l) return null
  // A legitimate delete retires what it removes, so a *successful* DELETE on a
  // path whose content is still owed means the deleting client had never
  // observed what it destroyed.
  const deleted = world.remote.calls.some(c => c.op === 'delete' && c.path === l.path && c.status === 200)
  return {
    invariant: 'durability',
    cause: deleted ? 'delete' : 'overwrite',
    detail:
      `${l.token} (written by ${l.origin} to ${l.path}'s ${l.field} at step ${String(l.step)}) is gone: ` +
      `not on the remote (${world.remote.paths().join(', ') || 'empty'}) and in no client's cache. ` +
      `No client that had observed it asked for it to go.`,
  }
}

// ── Invariant 2: clean-truth ─────────────────────────────────────────

function checkCleanTruth(world: WorldView): Violation | null {
  for (const c of world.clients) {
    for (const row of c.rows) {
      if (row.status !== 'clean') continue
      if (row.version === undefined) {
        return {
          invariant: 'clean-truth',
          detail:
            `${c.id} holds ${row.path} clean with no version. The next edit CASes with no ` +
            `precondition, which every backend reads as "must be absent" — a conflict, and a ` +
            `conflict copy, manufactured by us (#738).`,
        }
      }
      const held = world.remote.contentAtVersion(row.version)
      // `undefined`, not falsy: an empty file is content the remote can hold.
      if (held === undefined) {
        return {
          invariant: 'clean-truth',
          detail: `${c.id} holds ${row.path} clean at version ${row.version}, which this remote never minted.`,
        }
      }
      if (held !== row.content) {
        return {
          invariant: 'clean-truth',
          detail:
            `${c.id} holds ${row.path} clean at version ${row.version}, but the remote's content at ` +
            `that version is not what the row holds. The row's next CAS would pass against content ` +
            `it never saw (#520/#529).`,
        }
      }
    }
  }
  return null
}

// ── Invariant 3: no manufactured conflict ────────────────────────────

const CONFLICT_SUFFIX_RE = /_\d{8}-\d{6}\.md$/

/** `note_20260101-120000.md` -> `note.md`. */
function baseOfConflictCopy(path: string): string {
  return path.replace(CONFLICT_SUFFIX_RE, '') + '.md'
}

function checkNoManufacturedConflict(world: WorldView, ledger: Ledger): Violation | null {
  for (const path of world.remote.paths()) {
    if (!CONFLICT_SUFFIX_RE.test(path)) continue
    if (ledger.judgedCopies.has(path)) continue
    ledger.judgedCopies.add(path)
    const copy = world.remote.get(path)?.content ?? ''
    const base = baseOfConflictCopy(path)
    const original = world.remote.get(base)?.content
    // Nothing at the base path: `resolveCollision` only copies out when it has
    // read something there, so this is a base deleted since — there is no
    // longer anything to attribute the conflict against.
    if (original === undefined) continue

    // #738 exactly: a duplicate entry conjured out of a conflict that never
    // happened. Nothing was preserved, because nothing had diverged.
    if (original === copy) {
      return {
        invariant: 'no-manufactured-conflict',
        detail: `${path} is byte-identical to ${base} — a conflict copy of a conflict that never happened (#738).`,
      }
    }

    // A copy is the price of two clients writing without seeing each other. If
    // every token involved came from one client, there was no second writer.
    const origins = new Set<string>()
    for (const t of tokensIn(copy)) { const o = ledger.originOf(t); if (o) origins.add(o) }
    for (const t of tokensIn(original)) { const o = ledger.originOf(t); if (o) origins.add(o) }
    if (origins.size === 1) {
      return {
        invariant: 'no-manufactured-conflict',
        detail:
          `${path} was copied out, but every token in it and in ${base} was written by ` +
          `${[...origins][0] ?? '?'} — one writer cannot conflict with itself.`,
      }
    }
  }
  return null
}

// ── Invariant 4: store/cache coherence ───────────────────────────────

function slugOf(path: string): string { return path.replace(/\.md$/, '') }

function checkStoreCacheCoherence(world: WorldView): Violation | null {
  for (const c of world.clients) {
    const cached = new Set(c.rows.filter(r => r.status !== 'deleted').map(r => slugOf(r.path)))
    const missing = [...cached].filter(s => !c.storeSlugs.has(s) && !c.seamOnlySlugs.has(s))
    const extra   = [...c.storeSlugs].filter(s => !cached.has(s) && !c.seamDeletedSlugs.has(s))
    if (missing.length > 0) {
      return {
        invariant: 'store-cache-coherence',
        detail: `${c.id}: ${missing.join(', ')} is in the cache but not in the store — invisible until a reload.`,
      }
    }
    if (extra.length > 0) {
      return {
        invariant: 'store-cache-coherence',
        detail: `${c.id}: ${extra.join(', ')} is in the store but not in the cache — it would vanish on reload.`,
      }
    }
  }
  return null
}

// ── Invariants 5 and 6: progress and convergence ─────────────────────

function checkProgress(world: WorldView): Violation | null {
  for (const c of world.clients) {
    const stuck = c.rows.filter(r => r.status !== 'clean')
    if (stuck.length > 0) {
      return {
        invariant: 'progress',
        detail:
          `${c.id} still owes ${stuck.map(r => `${r.path} (${r.status})`).join(', ')} after the world settled — ` +
          `a write the app accepted and stopped trying to deliver (#481).`,
      }
    }
  }
  return null
}

function checkConvergence(world: WorldView): Violation | null {
  const remotePaths = world.remote.paths()
  for (const c of world.clients) {
    const live = c.rows.filter(r => r.status !== 'deleted')
    const localPaths = live.map(r => r.path).sort()
    if (localPaths.join('|') !== remotePaths.join('|')) {
      return {
        invariant: 'convergence',
        detail:
          `${c.id} settled holding [${localPaths.join(', ')}] while the remote holds ` +
          `[${remotePaths.join(', ')}] (#168/#221/#516).`,
      }
    }
    for (const row of live) {
      const remote = world.remote.get(row.path)
      if (remote && remote.content !== row.content) {
        return {
          invariant: 'convergence',
          detail: `${c.id} settled with different content for ${row.path} than the remote holds.`,
        }
      }
    }
  }
  return null
}

// ── The whole check ──────────────────────────────────────────────────

/**
 * Every safety invariant, checked at one instant. Returns the first violation
 * rather than all of them: once one holds, the state the others read is
 * already off the rails, and a list of five consequences is harder to read
 * than the one cause.
 */
export function checkSafety(world: WorldView, ledger: Ledger): Violation | null {
  return checkDurability(world, ledger)
    ?? checkCleanTruth(world)
    ?? checkNoManufacturedConflict(world, ledger)
    ?? checkStoreCacheCoherence(world)
}

/** The two liveness invariants — only meaningful once the world has settled. */
export function checkLiveness(world: WorldView): Violation | null {
  return checkProgress(world) ?? checkConvergence(world)
}

/**
 * Whether the reconcile *may yet* legitimately be holding a path the remote no
 * longer has.
 *
 * `planReconcile` deliberately does not read a listing's silence about a
 * recently-written file as a remote delete — an eventually-consistent tree
 * listing omits a just-pushed file, and acting on that evicts the slug and
 * breaks every wikilink pointing at it (#221, #516). So a file another device
 * deleted cannot reach this one until the window passes, and asking two clients
 * to agree before then would be asserting against the code's own documented
 * behaviour rather than against a defect.
 *
 * Imported from `sync.ts` rather than mirrored: a copy of this number here
 * would silently stop matching the one that decides the behaviour.
 */
export function graceWindowPassed(world: WorldView, now: number): boolean {
  return world.clients.every(c => c.rows.every(r =>
    world.remote.has(r.path) || now - r.updatedAt >= RECONCILE_DELETE_GRACE_MS))
}
