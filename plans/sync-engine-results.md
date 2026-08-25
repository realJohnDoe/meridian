# Sync-Engine Review — Results

Run date: 2026-08-25 · Branch: `claude/sync-conflict-frontmatter-body-3hsrl3` · Survey: **none**

> This is an **ad-hoc review**, not a run of a survey in [`surveys/`](./surveys/)
> — there is no `surveys/sync-engine.md` to point at. It follows the shared
> reporting conventions in [`surveys/README.md`](./surveys/README.md) (impact,
> breadth, recommended model with a named hazard, summary table) so it can be
> worked as a checklist like any results file, and it is subject to
> [`plans/CLAUDE.md`](./CLAUDE.md): **remove a finding's section in the same PR
> that fixes it, and delete this file entirely once the last one closes out.**

---

## 1. Why this review happened

Two users editing the same note at the same time — one changing only
frontmatter (`repeat:`), the other only the markdown body — produced a conflict
copy, then five more as editing continued. Neither side had lost anything.

That incident was fixed in **PR #816** (`f1e06ba`), which added two three-way
merges:

- `model/merge.ts` · `mergeFileContent` — merges a divergent local and remote
  file against the ancestor the local edit was made from. Cache records now
  carry `baseContent` beside `version` (`storage/cache/db.ts` · `DexieFileRow`)
  so the ancestor is available at all. Called from `resolveCollision`
  (`storage/sync.ts`) before the conflict-copy fallback.
- `model/merge.ts` · `mergeEditFields` — narrows an editor save to the fields
  the user actually touched, so a stale editor stops reverting everything that
  moved underneath it. Called from `saveNode` (`editor/save.ts`).

**The findings below are what that investigation surfaced along the way and did
not fix.** They are independent of each other and of #816, except where a
sequencing note says otherwise.

Read [`GLOSSARY.md`](../GLOSSARY.md) entries *base version / base content*,
*merge / conflict copy*, and *touched fields* before starting on any of them.

## 2. Coverage statement

**Read in full:** `storage/sync.ts` (1129 lines), `storage/cache/files.ts`,
`storage/cache/db.ts`, `storage/conflictError.ts`, `storage/conflictName.ts`,
`storage/inFlight.ts`, `storage/syncJournal.ts`, `storage/moveEntry.ts`,
`storage/fs.ts` (CAS paths), `storage/githubBackend.ts` (statAll/read/write/
delete), `routes/__root.tsx` (sync wiring), `storeCommit.ts`,
`editor/save.ts`, `editor/useEntryEditor.ts`.

**Sampled:** `storage/vaultRegistry.ts`, `storage/backends.ts`,
`storage/localBackend.ts`, `storage/icalBackend.ts` (as the one backend that
*does* do conditional requests), `store.ts` (`deriveViews` only).

**Not examined:** `storage/ical/**` (the ICS parse pipeline — its own
subsystem, no bearing on write/conflict paths), `storage/githubOAuth.ts`,
`storage/exampleBackend.ts`, `worker/`.

**Method:** static reading plus the sync journal from the real incident. **No
finding below was reproduced at runtime** — per `CLAUDE.md` no dev server was
started. Each finding states its own confidence separately.

**Gates at time of writing** (on `f1e06ba`): `pnpm run build` PASS ·
`pnpm run lint` PASS (0 warnings) · `pnpm exec vitest run` PASS (119 files /
2490 tests, coverage thresholds met).

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Conflict detection & resolution | **findings: #3** |
| 2 | Sync scheduling & cadence | **findings: #7** |
| 3 | Write-path durability | **findings: #4, #5** |
| 4 | Observability | **findings: #6** |
| 5 | Cache transitions (`cache/files.ts`) | no open findings — six transitions, each with its precondition inside one Dexie transaction; covered at 95%+ by `storage/__tests__/cache.test.ts` against real Dexie |
| 6 | Reconcile planning (`planReconcile`) | no open findings — pure, unit-tested, and its eventual-consistency guards (`skipPaths`, `RECONCILE_DELETE_GRACE_MS`, in-flight union) are each justified in-place |
| 7 | Store-layer merge (`mergeChangedIntoStore`) | no open findings — writes one vault layer, evict-then-re-add whole entries |

---

## 4. Findings

### Summary table

| # | Title | Category | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|
| 3 | `delete` trusts a stale SHA cache that `write` refuses to | `conflict-detection` | 8 | 1 file (1 line) | **Sonnet 5** |
| 4 | A save into an unregistered vault vanishes silently | `durability` | 6 | 1 file (2 sites) | **Haiku 4.5** |
| 5 | A cross-vault move is two writes with no transaction | `durability` | 7 | 1 file | **Opus 5** |
| 6 | The sync journal does not survive a reload | `observability` | 5 | 1 file | **Sonnet 5** |
| 7 | `flushPendingPush` bursts every vault at once | `cadence` | 3 | 1 file | **Sonnet 5** |

Ranked by `(impact × breadth) ÷ effort` per the shared convention, with impact
and breadth reported separately so the list can be re-sorted.

---

### Finding #3 — `delete` trusts a stale SHA cache that `write` refuses to

- **Category:** `conflict-detection`
- **Impact:** 8. A delete conditioned on a stale SHA destroys a remote edit that
  the same reasoning, one function earlier, is explicitly written to protect.
- **Breadth:** 1 file, 1 line.
- **Recommended model:** **Sonnet 5.** The hazard that makes this more than a
  one-line deletion: `delete` returns early when it has no SHA —
  `githubBackend.ts:285`, `if (!sha) return // File doesn't exist on GitHub` —
  and `pushDirty`'s tombstone loop reads that as success and calls
  `confirmDeleted`, dropping the tombstone. So simply removing the `_shas`
  fallback converts "delete with a cold cache" into "silently forget the
  delete". The fix must fetch a fresh SHA instead of falling back to the cached
  one, and must keep the genuine 404-is-success path
  (`githubBackend.ts:301-304`) intact. With that named, Sonnet 5.

**Evidence.** `write` documents why the cache must not be trusted —
`storage/githubBackend.ts:256-262`:

```ts
  async write(path: string, content: string, expectedVersion?: string): Promise<string | undefined> {
    try {
      // Use the caller-supplied expectedVersion as the CAS SHA.
      // Avoid falling back to _shas here — that cache may be stale from a
      // prior statAll() call, which is eventually-consistent on GitHub.
```

`delete` then does the fallback anyway — `storage/githubBackend.ts:279-285`:

```ts
  async delete(path: string, expectedVersion?: string): Promise<void> {
    // Prefer the caller-supplied expectedVersion as the CAS SHA, matching
    // write()'s policy — avoid falling back to _shas first here, since that
    // cache may be stale from a prior statAll() call and could mask a genuine
    // remote edit that happened after the tombstone was staged.
    const sha = expectedVersion ?? this._shas.get(path)
    if (!sha) return // File doesn't exist on GitHub; nothing to do
```

Note the comment says it avoids the fallback; the code on the next line performs
it. `_shas` is populated from `statAll`'s tree listing (`githubBackend.ts:160`)
— exactly the eventually-consistent source `write`'s comment names.

**Problem.** `recordLocalDelete` (`cache/files.ts`) preserves the record's
`version`, so in the normal path `expectedVersion` is defined and the fallback
never fires. It fires when the tombstone has **no** base version — a file
created and deleted locally before it ever synced, or a record whose version was
lost. In that case the delete goes out with whatever SHA the last tree listing
happened to hold, which may predate another device's edit, and GitHub accepts
it. The tombstone loop in `pushDirty` has a careful
`delete-conflict` branch that keeps the remote version instead of destroying it
— this path bypasses that branch entirely by never producing a conflict.

**Fix.** Drop the `_shas` fallback. When `expectedVersion` is undefined, do a
fresh `readFiles([path])` and use that SHA; if the file genuinely isn't there,
keep the current early-return. Add a journal event for the re-read so the
distinction between "already gone" and "re-read then deleted" is visible.

**Test to add** (`storage/__tests__/sync.test.ts`, alongside the existing
`pushDirty — delete-conflict tombstone handling` suite): a tombstone with no base version, against a
backend whose content changed since the last `statAll`, must produce a
`delete-conflict` and keep the remote file — not delete it.

---

### Finding #4 — A save into an unregistered vault vanishes silently

- **Category:** `durability`
- **Impact:** 6. Same shape as the data-integrity survey's finding #1 — the UI
  reports the entry saved while nothing is durable — but at a different gate.
- **Breadth:** 1 file, 2 sites (`writeEntityToCache`, `deleteFromBackend`).
- **Recommended model:** **Haiku 4.5.** The one piece of judgment, which must be
  stated in the task: **the two conditions in that guard are not equally
  anomalous.** `backend.readOnly` is *normal* — an iCal subscription is
  read-only by design and the editor already refuses to write to one, so
  toasting there would spam users with an expected non-event. `!backend` (the
  vault is not registered) is the anomaly worth surfacing. Treat them
  separately. With that named, Haiku 4.5; the rest is a journal call and a
  toast.

**Evidence** — `storage/sync.ts:1088-1093`:

```ts
export async function writeEntityToCache(entryKey: EntryKey, content: string): Promise<void> {
  const path = keyToPath(entryKey)
  markInFlight(entryKey)
  try {
    const backend = backendFor(entryKey)
    if (!backend || backend.readOnly) return
```

and identically at `storage/sync.ts:1108-1113` for `deleteFromBackend`.

**Problem.** The store has already committed the edit by the time this runs
(`storeCommit.ts` · `commitNext` calls `setData` first, then `persistEntries`),
so the entry is on screen and looks saved. This returns without recording
anything: no cache row, no journal event, no toast. On the next reload the edit
is gone with no trace of why. `vaultRegistry.ts:169` acknowledges the behaviour
in passing — "refused by `writeEntityToCache`, silently" — but nothing surfaces
it.

The `!backend` case is reachable: `backendFor` resolves through
`getBackend(keyVaultId(key))`, and a vault can be removed in Settings while an
editor is open on one of its entries, or a commit can land from a toast callback
(`occurrenceActions.ts` arms deferred commits) after the vault unmounted.

**Fix.** Split the guard. For `readOnly`, return as now (optionally a `debug`-
level journal line). For `!backend`, add a `SyncEventKind` — e.g.
`'write-refused'` (`storage/syncJournal.ts:33-56`) — journal it with the vault
id from the key, and `notifyError`/`warn` the user that the entry could not be
saved because its vault is no longer connected.

---

### Finding #5 — A cross-vault move is two writes with no transaction

- **Category:** `durability`
- **Impact:** 7. The failure produces a **duplicate**, which is worse than a
  failed move: the user believes the note moved, and now two vaults each hold a
  copy that will diverge independently.
- **Breadth:** 1 file (`storage/moveEntry.ts`), but it is the only cross-vault
  write path in the app.
- **Recommended model:** **Opus 5.** Not because the code is hard but because
  **there is no correct fix without a product decision**: two Dexie vault
  layers and two independent remote backends cannot be made atomic, so the
  options are (a) accept non-atomicity and add detection + a repair action,
  (b) stage the move so the source delete only fires after the target push is
  confirmed, which means persisting move intent across reloads, or (c) refuse
  cross-vault moves while either vault is offline. Each has a different UX. Pick
  with the user. The named hazard for any of them: `commitMove`
  (`storeCommit.ts`) has **already re-keyed the store** before this runs, so a
  fix that aborts here leaves the store and the cache disagreeing about which
  vault owns the entry.

**Evidence** — `storage/moveEntry.ts:61-68`:

```ts
    await recordLocalEdit(to.id, keyToPath(toKey), content)
    await recordLocalDelete(from.id, keyToPath(fromKey))

    updateSyncUI(to)
    updateSyncUI(from)
    scheduleAutoPush(to)
    scheduleAutoPush(from)
```

**Problem.** Three ways this leaves a duplicate:

1. The process dies between the two `await`s — the target has the entry, the
   source has no tombstone.
2. Both cache writes land, but the two pushes are independent: `scheduleAutoPush`
   is per backend, each with its own `VaultSyncState`, its own
   `consecutiveFailures`, and its own `nextRetryAt`. The
   target vault can push immediately while the source vault sits in a 30-minute
   backoff, or is offline, or needs re-auth.
3. The source delete conflicts (someone edited the note in the source vault
   after the move was staged). `pushDirty`'s tombstone branch correctly keeps
   the remote version and drops the tombstone — which is
   the right call in isolation but here means the move silently became a copy,
   and nothing reconciles that against the target vault.

There is no compensation, no journal event tying the two halves together, and no
way for either half to discover the other's outcome.

**Fix.** Decide the policy with the user first. Whichever is chosen, a
prerequisite is cheap and worth doing regardless: **journal both halves with a
shared correlation id** so the duplicate is at least diagnosable
(`SyncEventDetail.note` already exists for free-form values).

---

### Finding #6 — The sync journal does not survive a reload

- **Category:** `observability`
- **Impact:** 5. Not a defect in behaviour — a limit on the ability to diagnose
  the other findings. Worth stating that this is a **deliberate trade** with a
  real justification, not an oversight.
- **Breadth:** 1 file.
- **Recommended model:** **Sonnet 5.** The named hazard is the reason the
  current design exists — `storage/syncJournal.ts:19`: *"**Deliberately not
  persisted.** Dexie is part of what this instruments"*. A journal written
  through Dexie cannot be trusted to record a Dexie failure, so **the fix must
  not use Dexie**. `localStorage` is the natural second sink (that file already
  touches it for the debug flag at `syncJournal.ts:112`), and the write must be
  wrapped in try/catch — Safari private mode throws on access, which the
  existing code already handles. Second hazard: keep `syncJournalDump`'s output
  format byte-identical, since it is what users paste into bug reports and what
  `storage/__tests__/syncJournal.test.ts` asserts on.

**Evidence** — `storage/syncJournal.ts:96-105`:

```ts
/**
 * How many events are kept. A busy editing session produces roughly one event
 * per file per push cycle (~2.5s while typing), so this is on the order of ten
 * minutes of history — comfortably longer than the gap between the writes that
 * cause a conflict and the conflict itself, and small enough to be pasteable.
 */
const CAPACITY = 400

const _events: SyncEvent[] = []
```

**Problem.** The stated reasoning — "comfortably longer than the gap between the
writes that cause a conflict and the conflict itself" — held in the real
incident only because the user opened the toast's details **while the events
were still in the ring**. The gap that mattered was 244 seconds, well inside ten
minutes; but the ring is capacity-bounded, not time-bounded, so a busier session
evicts faster. And a reload clears it outright.

For a bug class that is rare, cross-device, and hard to reproduce, the diagnosis
window being "since this tab loaded, up to 400 events" is the wrong durability.
A conflict noticed an hour later, or after the PWA was restarted, has no trace at
all — and the *other* device's journal, which is often the one that explains the
sequence, is a separate ring on separate hardware.

**Fix.** Add a coarser second sink that does not share the instrumented
dependency: append to a bounded `localStorage` ring (a few hundred events;
`SyncEvent` is flat and JSON-safe by design, per its doc comment) on a debounce,
and have `syncJournalDump` read the persisted ring plus the in-memory one.
Consider including the vault id and a device label so two devices' dumps can be
interleaved by hand.

---

### Finding #7 — `flushPendingPush` bursts every vault at once

- **Category:** `cadence`
- **Impact:** 3. Minor with two vaults; it contradicts a policy the scheduler
  elsewhere goes to real trouble to maintain.
- **Breadth:** 1 file.
- **Recommended model:** **Sonnet 5** — and the task should say **the obvious
  fix may be wrong**, which is why this is not Haiku. `flushPendingPush` is the
  `pagehide` handler (`routes/__root.tsx:197`), i.e. the last moment anything
  runs before teardown. Serializing the vaults with `await` makes it *more*
  likely that later vaults never flush at all, which is the failure the
  function exists to prevent — its own doc comment says a vault skipped here
  "keeps its edit stranded in Dexie until the next launch". The right answer is
  probably to keep the parallel burst on the `pagehide` path and serialize only
  the non-teardown callers, or to leave it alone and document why it differs.
  Deciding that is the work.

**Evidence.** `autoSyncTick` is deliberately serial — `storage/sync.ts:1005+`,
whose doc comment reads *"**Oldest-synced first, one at a time.** Serial rather
than parallel on purpose: each `GitHubBackend` owns its own throttled Octokit
client, so nothing coordinates bursts across vaults"*. It `await`s each
`runSync` inside the loop.

`flushPendingPush` does not — `storage/sync.ts:908-912`:

```ts
export function flushPendingPush(): void {
  for (const backend of getMountedBackends()) {
    if (!backend.readOnly) attemptPush(backend)
  }
}
```

`attemptPush` (`sync.ts:883-887`) fires `void runSync(...)` without awaiting, so
every vault starts a cycle simultaneously.

**Problem.** Two callers reach this: `pagehide`/`visibilitychange`
(`routes/__root.tsx:197`, `:174`) and vault registration. On the teardown path
the burst is arguably correct — there is no time to be polite. On the
registration path it is the same uncoordinated multi-vault burst
`autoSyncTick`'s comment argues against.

**Fix.** Whichever policy is chosen, make the difference explicit in the code
rather than incidental: either split the function into a `flushNow` (parallel,
teardown) and a `flushSoon` (serial, everything else), or add a doc comment
stating that the parallel burst is intentional here and why.

---

## 5. Not findings — checked and deliberately left alone

- **`resolveCollision`'s one-attempt merge policy.** It does not retry after a
  refused merge write; it copies out. That is correct — a path moving under us
  is exactly when the lossless outcome matters most.
- **Body-vs-body conflicts still producing a conflict copy.** Deliberate. Two
  people typing in the same prose genuinely overlap and inventing an
  interleaving is worse than handing both versions back. No diff3 wanted.
- **No conflict-copy rate limiting.** Considered and dropped during #816: with
  the `saveNode` narrowing in place there is nothing left feeding a *run* of
  copies. The signal that would reopen it: a `collision-copied` run in a journal
  where the losing content is body-only on both sides.
- **The open editor not live-updating from the store.** Deliberate — a live
  re-read moves the cursor and reshuffles the form under the user. #816 removed
  the data loss this caused; the staleness itself is a UX question, not a
  correctness one.
- **`RECONCILE_DELETE_GRACE_MS` applying only to the delete branch.** Correct
  and justified in-place: the changed branch confirms itself via a fresh read.
