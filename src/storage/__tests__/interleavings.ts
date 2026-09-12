/**
 * A generator over **interleavings**, and the interpreter that runs one against
 * the two-client harness while checking the six invariants (#1021).
 *
 * ## Why interleavings rather than file text
 *
 * #1003 generates a structured record and `.map()`s it to a `.md` file, because
 * there the input under test *is* a file. Here it is not: every sync defect in
 * the record — all thirty — is a statement about an **order of events across two
 * devices**, not about any one file's bytes. The #1006 spike report says so in
 * its recommended follow-up: *"a seed here is a scripted interleaving, so the
 * generator to write is one over interleavings, not over file text."*
 *
 * So a seed is a sequence of `Op`s. The two shrinking properties that made
 * #1003's generator usable carry over unchanged:
 *
 *  - **Every sub-sequence is runnable.** Both clients exist for the whole run
 *    and the path alphabet is fixed, so fast-check's array shrinker — which
 *    removes elements — can never produce a sequence that fails for a different
 *    reason than the original. That is the interleaving equivalent of #1003's
 *    "never a raw string": a counterexample shrinks to a minimal *sequence*, and
 *    `formatOps` renders it straight into a corpus case.
 *  - **Content is derived, not generated.** A write's content comes from what
 *    that client currently holds, with one field replaced by a token unique to
 *    the step. The generator never has to produce parseable YAML, and every
 *    write is exactly one field's worth of change — which is what makes the
 *    disjoint-edit merge branch of `resolveCollision` reachable at all.
 *
 * ## The three traps the spike already paid for
 *
 * All three are load-bearing here and all three are silent when got wrong, so
 * they are re-stated where they bite:
 *
 *  1. The fake clock is installed once per file and never rewound (Octokit's
 *     Bottleneck limiters are process-global) — `useFixedClock`, called from
 *     the test file's `beforeAll`.
 *  2. A debounced push outlives the step that armed it — every step here ends
 *     in `quiesce`, not just the scenario.
 *  3. `store.ts` needs a DOM — the test file runs under jsdom.
 */
import fc from 'fast-check'
import { cacheLoadAll } from '@/storage/cache/files'
import { writeEntityToCache, deleteFromBackend } from '@/storage/entityWrites'
import { entryKey, keySlug } from '@/fileIO'
import { getVaultLayer } from '@/storeBridge'
import {
  makeClient, reloadClient, closeApp, settle, quiesce, syncClient, registerVaults, skipAhead,
  pendingBackendCalls,
} from './twoClientHarness'
import type { Client, FakeGitHub } from './twoClientHarness'
import { Ledger, checkSafety, checkLiveness, graceWindowPassed, tokenFor } from './syncInvariants'
import type { Violation, WorldView, ClientView, Field } from './syncInvariants'

// ── The alphabet ─────────────────────────────────────────────────────

/** Two devices. Two is enough: every defect in the record is a two-writer story. */
const CLIENT_IDS = ['deviceA', 'deviceB'] as const
export type ClientId = (typeof CLIENT_IDS)[number]

/**
 * Two slugs. Small on purpose — collisions are the interesting part, and a wide
 * path alphabet spends runs on files that never meet.
 */
const SLUGS = ['note', 'plan'] as const
export type Slug = (typeof SLUGS)[number]

/**
 * Whether the page stayed open long enough for the write's own debounced push.
 *
 * Not a decoration: it is the only way to reach a **dirty row with no base
 * version**, which is the precondition under half the defects in the record —
 * #827's delete fallback, #1017, #481's stranded writes. `scheduleAutoPush`
 * arms a 1s timer on every write and the harness's pump crosses a full second
 * on its way through the *next* step, so an edit that is meant not to have
 * reached the remote is only true if the page closed first. That is what
 * `closeApp` does, and why this rides on the op rather than being a separate
 * one: a `close` in its own step always arrives after the push it was supposed
 * to pre-empt.
 */
export type Staging =
  /** The debounce fires: the change is pushed before the next step. */
  | 'pushed'
  /** The page closes first: the change is durable locally and nothing went out. */
  | 'draft'
  /**
   * The debounce fires and the write lands, but its acknowledgement is lost —
   * the response carries no token and the repair read that follows cannot get
   * through either (`FakeGitHub.loseWriteAck`).
   *
   * The third staging rather than a fourth op, for the reason above: a fault
   * armed in its own step lands on whichever push happens to go out next, which
   * on this pump is rarely the write it was written for. It reaches the one
   * state the other two cannot — a record that is **clean with no version** —
   * and that state is not exotic: any dropped connection between the commit and
   * its answer produces it, on a file this device really does own.
   */
  | 'unacked'

/**
 * A delete stages two ways, not three: a `DELETE` returns no token to lose, so
 * there is no acknowledgement whose absence would leave a record behind.
 */
export type DeleteStaging = Exclude<Staging, 'unacked'>

export type Op =
  /**
   * The user edits one field of one entry. `title` and `body` are separate
   * because that difference decides which branch of `resolveCollision` a
   * concurrent pair reaches: two body edits overlap and copy out, a title edit
   * against a body edit is disjoint and merges.
   */
  | { t: 'write';  c: ClientId; slug: Slug; field: 'title' | 'body'; staging: Staging }
  /** The user deletes the entry. */
  | { t: 'delete'; c: ClientId; slug: Slug; staging: DeleteStaging }
  /** One full sync cycle: push what's dirty, reconcile against the listing. */
  | { t: 'sync';   c: ClientId }
  /** The page reloads: cold `_shas`, cold tree ETag, the Dexie rows surviving. */
  | { t: 'reload'; c: ClientId }

// ── The generator ────────────────────────────────────────────────────

const clientArb = fc.constantFrom(...CLIENT_IDS)
const slugArb   = fc.constantFrom(...SLUGS)

/**
 * Weighted towards `sync`, and it matters. A sequence with no sync is just two
 * caches filling up: the storage layer under test barely runs, and none of the
 * six invariants can be broken. Writes and deletes need to be common enough to
 * collide; `close` and `reload` are rarer because their job is to reach one
 * specific state — a dirty row with no base version — which two of them in a
 * row does no better than one.
 */
const stagingArb = fc.constantFrom('pushed' as const, 'draft' as const, 'unacked' as const)
const deleteStagingArb = fc.constantFrom('pushed' as const, 'draft' as const)

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({
    t: fc.constant('write' as const), c: clientArb, slug: slugArb,
    field: fc.constantFrom('title' as const, 'body' as const), staging: stagingArb,
  }) },
  { weight: 4, arbitrary: fc.record({ t: fc.constant('sync' as const), c: clientArb }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('delete' as const), c: clientArb, slug: slugArb, staging: deleteStagingArb }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('reload' as const), c: clientArb }) },
)

export function interleavingArb(maxLength: number): fc.Arbitrary<Op[]> {
  return fc.array(opArb, { minLength: 2, maxLength })
}

/** Render a sequence as the harness calls it stands for — paste-ready for the corpus. */
export function formatOps(ops: readonly Op[]): string {
  return ops.map(op => {
    switch (op.t) {
      case 'write':  return `write('${op.c}', '${op.slug}', '${op.field}', '${op.staging}')`
      case 'delete': return `del('${op.c}', '${op.slug}', '${op.staging}')`
      case 'sync':   return `sync('${op.c}')`
      case 'reload': return `reload('${op.c}')`
    }
  }).join('\n')
}

// ── Content ──────────────────────────────────────────────────────────

const pathOf = (slug: Slug): string => `${slug}.md`

/** A file with both fields carrying a token, so either edit is observable. */
function freshNote(slug: Slug, token: string): string {
  return `---\ntitle: ${slug} ${token}\n---\n\n${token}\n`
}

/**
 * The next content for `slug` on this client: what it holds now with one field
 * replaced, or a fresh note when it holds nothing.
 *
 * Deriving from the client's own row is what a real editor does, and it is also
 * what keeps the three-way merge meaningful — `baseContent` only buys anything
 * if the two sides really are edits of a common ancestor.
 */
function nextContent(
  current: string | undefined, slug: Slug, field: Field, token: string,
): { content: string; fields: Field[] } {
  const m = current === undefined ? null : /^---\ntitle: (.*)\n---\n\n([\s\S]*)$/.exec(current)
  // Creating the file from nothing sets both halves at once, and the ledger has
  // to be told so — otherwise the half this write did not name would stay owed
  // to a client that has since replaced it.
  if (!m) return { content: freshNote(slug, token), fields: ['title', 'body'] }
  const [, title, body] = m
  return field === 'title'
    ? { content: `---\ntitle: ${slug} ${token}\n---\n\n${body ?? ''}`, fields: ['title'] }
    : { content: `---\ntitle: ${title ?? slug}\n---\n\n${token}\n`, fields: ['body'] }
}

// ── The interpreter ──────────────────────────────────────────────────

/**
 * How far past `RECONCILE_DELETE_GRACE_MS` the settling phase jumps.
 *
 * Reconcile deliberately ignores a listing's silence about a recently-written
 * file for five minutes (an eventually-consistent tree listing must not be read
 * as a remote delete — #221/#516). A remote delete therefore *cannot* reach the
 * other client before then, so asking two clients to agree without crossing
 * that window would assert against the code's own documented behaviour.
 */
const SETTLE_SKIP_MS = 6 * 60_000

/**
 * How many alternating sync rounds the settling phase gets before the two
 * liveness invariants are asserted regardless.
 *
 * Three is one more than the pipeline should ever need — a push, then the pull
 * that sees it — with a round spare for a conflict resolved along the way.
 * Anything still moving after that is not slow, it is looping.
 */
const SETTLE_ROUNDS = 3

/** `${clientId} ${slug}` -> its two halves. */
function splitKey(key: string): [string, string] {
  const at = key.indexOf(' ')
  return [key.slice(0, at), key.slice(at + 1)]
}

/** The slugs one client holds in a seam-exemption set. */
function slugsFor(keys: ReadonlySet<string>, id: string): Set<string> {
  return new Set([...keys].filter(k => splitKey(k)[0] === id).map(k => splitKey(k)[1]))
}

export interface RunResult {
  violation: Violation | null
  /** How far the sequence got — the prefix a counterexample needs to reproduce. */
  steps: number
}

/**
 * TEMPORARY PROBE (#1052). Report a `runInterleaving` return that leaves work
 * behind.
 *
 * Every `if (violation) return` below skips the rest of the run, and with it
 * every remaining `quiesce`. If a cycle is live at that moment, the run ends
 * with it still going — and the next `resetWorld()` bumps the generation out
 * from under it.
 */
function leakProbe(where: string, violation: Violation | null): void {
  if (pendingBackendCalls() > 0) {
    console.warn(
      `#1052 probe: runInterleaving returned from ${where} with ${String(pendingBackendCalls())} ` +
      `backend call(s) in flight (violation: ${violation?.invariant ?? 'none'})`,
    )
  }
}

/**
 * Run one interleaving, checking the four safety invariants after every step
 * and the two liveness invariants whenever the world is settled.
 *
 * Returns the first violation rather than throwing, so the caller decides what
 * a violation means — a red build, or a known-and-filed defect (see
 * `KNOWN_VIOLATIONS` in `twoClientGenerated.test.ts`).
 */
export async function runInterleaving(remote: FakeGitHub, ops: readonly Op[]): Promise<RunResult> {
  const clients = new Map<ClientId, Client>()
  for (const id of CLIENT_IDS) clients.set(id, makeClient(id))
  const all = [...clients.values()]
  registerVaults(...all)

  const ledger = new Ledger()
  // The two seam exemptions — see `ClientView` in `syncInvariants.ts`. Both are
  // keyed `${clientId} ${slug}` and both are spent as soon as the storage layer
  // is observed doing what the committing layer would have done.
  const seamOnly = new Set<string>()
  const seamDeleted = new Set<string>()
  const vaultIds: readonly string[] = CLIENT_IDS

  const client = (id: ClientId): Client => {
    const c = clients.get(id)
    if (!c) throw new Error(`interleaving: no client ${id}`)
    return c
  }

  const snapshot = async (): Promise<WorldView> => {
    const views: ClientView[] = []
    for (const id of CLIENT_IDS) {
      const c = client(id)
      const rows = await cacheLoadAll(c.vaultId)
      const storeSlugs = new Set([...getVaultLayer(c.vaultId).keys()].map(k => keySlug(k)))
      // An exemption is spent the moment the storage layer is seen putting the
      // path in the store: from then on this client is held to both directions.
      for (const slug of storeSlugs) seamOnly.delete(`${id} ${slug}`)
      for (const k of [...seamDeleted]) {
        const [kid, slug] = splitKey(k)
        if (kid === id && !storeSlugs.has(slug)) seamDeleted.delete(k)
      }
      views.push({
        id, vaultId: c.vaultId, rows, storeSlugs,
        seamOnlySlugs:    slugsFor(seamOnly, id),
        seamDeletedSlugs: slugsFor(seamDeleted, id),
      })
    }
    return { remote, clients: views }
  }

  /**
   * How many times the remote's content has actually moved. Counted from the
   * call trace rather than tracked by hand, so it cannot drift from what the
   * remote really did.
   */
  const remoteMutations = (): number =>
    remote.calls.filter(c => (c.op === 'write' || c.op === 'delete') && c.status === 200).length
  /** The remote's mutation count as of each client's last completed cycle. */
  const syncedAt = new Map<ClientId, number>()

  /**
   * The world has stopped moving: nothing is dirty anywhere, **and** every
   * client has completed a sync cycle since the last time the remote changed.
   *
   * The second half is not pedantry. Without it, "B has no rows and A's are all
   * clean" reads as settled the instant A pushes — and convergence would then
   * fail on a B that has simply not synced yet, which is not a defect but the
   * ordinary state of a second device between cycles.
   */
  const settled = (world: WorldView): boolean =>
    world.clients.every(c => c.rows.every(r => r.status === 'clean')) &&
    CLIENT_IDS.every(id => syncedAt.get(id) === remoteMutations()) &&
    graceWindowPassed(world, Date.now())

  let steps = 0
  for (const [i, op] of ops.entries()) {
    const c = client(op.c)
    switch (op.t) {
      case 'write': {
        const token = tokenFor(i)
        const rows = await cacheLoadAll(c.vaultId)
        const row = rows.find(r => r.path === pathOf(op.slug) && r.status !== 'deleted')
        const { content, fields } = nextContent(row?.content, op.slug, op.field, token)
        // Armed before the edit, not after: the debounced push can go out any
        // time from here on, and the fault has to already be in place when it
        // does.
        if (op.staging === 'unacked') remote.loseWriteAck(pathOf(op.slug))
        await settle(writeEntityToCache(entryKey(c.vaultId, op.slug), content))
        if (op.staging === 'draft') closeApp(c)
        ledger.noteWrite(op.c, pathOf(op.slug), fields, token, i)
        seamOnly.add(`${op.c} ${op.slug}`)
        seamDeleted.delete(`${op.c} ${op.slug}`)
        break
      }
      case 'delete': {
        // A user can only delete an entry that is in front of them. Skipping
        // the op when this client holds no live row for the slug is the
        // interleaving equivalent of #1003's "never generate a raw string":
        // without it, shrinking happily produces "device A deletes a path it
        // has never heard of", which reproduces #1017 in two steps but is not
        // a sequence any UI can issue — a counterexample nobody can act on.
        const rows = await cacheLoadAll(c.vaultId)
        if (!rows.some(r => r.path === pathOf(op.slug) && r.status !== 'deleted')) break
        await settle(deleteFromBackend(entryKey(c.vaultId, op.slug)))
        if (op.staging === 'draft') closeApp(c)
        ledger.noteDelete(op.c, pathOf(op.slug))
        seamDeleted.add(`${op.c} ${op.slug}`)
        seamOnly.delete(`${op.c} ${op.slug}`)
        break
      }
      case 'sync':
        await syncClient(c)
        syncedAt.set(op.c, remoteMutations())
        break
      case 'reload':
        clients.set(op.c, reloadClient(c))
        registerVaults(...CLIENT_IDS.map(id => client(id)))
        break
    }
    await quiesce(vaultIds)
    steps = i + 1

    const world = await snapshot()
    ledger.observe(world)
    const violation = checkSafety(world, ledger) ?? (settled(world) ? checkLiveness(world) : null)
    if (violation) { leakProbe('the op loop', violation); return { violation, steps } }
  }

  // ── The settling phase ─────────────────────────────────────────────
  // Every run ends here, so the two liveness invariants are checked at least
  // once per run rather than only when a sequence happened to end quiet.
  // Two rounds each, alternating: one cycle pushes and reconciles against a
  // listing that may still be catching up, and the second is the one that sees
  // a settled remote.
  let world = await snapshot()
  for (let round = 0; round < SETTLE_ROUNDS; round++) {
    // The skip goes *inside* the round, not once before the loop. A round can
    // itself create a fresh grace window — the first cycle pulls a file the
    // other device is about to delete, stamping the row's `updatedAt` to now —
    // and a single skip up front would leave that last one un-expired at the
    // final assertion, reporting the reconcile's own documented behaviour as a
    // convergence failure.
    //
    // Only when it is actually in play, though: jumping six virtual minutes
    // fires every intervening timer, Octokit's second-spaced write limiter
    // included, and paying that on every round of every run is most of what a
    // sweep costs.
    if (!graceWindowPassed(world, Date.now())) await skipAhead(SETTLE_SKIP_MS, vaultIds)
    // Always a full round, even from a world that already looks quiet: "quiet"
    // is only the precondition for *asking* whether the two clients agree, not
    // an answer. A device that has not run a cycle since the other one deleted
    // a file is quiet and stale at the same time.
    for (const id of CLIENT_IDS) {
      await syncClient(client(id))
      syncedAt.set(id, remoteMutations())
      world = await snapshot()
      ledger.observe(world)
      const violation = checkSafety(world, ledger)
      if (violation) { leakProbe('the settling phase', violation); return { violation, steps } }
    }
    if (settled(world) && checkLiveness(world) === null) break
  }

  // Unconditional: a world that would not settle in `SETTLE_ROUNDS` rounds of
  // undisturbed syncing has something that never drains, and `progress` is the
  // invariant that says so.
  const finalViolation = checkSafety(world, ledger) ?? checkLiveness(world)
  leakProbe('the final check', finalViolation)
  return { violation: finalViolation, steps }
}
