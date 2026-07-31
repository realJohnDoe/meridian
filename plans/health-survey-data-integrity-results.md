# Data Integrity & Durability Survey — Results

Survey run: 2026-07-31, branch `claude/data-integrity-durability-survey-57d9f7`, worktree `octokit-lazy-bundle-9ac43c`.
Brief: [health-survey-data-integrity.md](health-survey-data-integrity.md).

---

## 1. Integrity verdict

Yes — this app can lose the user's writing, and the two worst cases are both silent. The headline is **`resolveCollision` in `src/storage/sync.ts`: it overwrites the dirty cache record with the freshly-pulled remote content *before* it writes the user's version to a conflict copy**, so if that copy write fails (offline mid-sync, a rate-limited 403, an expired token) the local edit exists nowhere — not on the backend, not in IndexedDB — while the UI says "You're offline — changes are saved locally and will sync when you reconnect." The second-worst is structural rather than a slip: **inheritance is flattened at parse time and re-derived on collapse, and "cleared" is not representable in that round-trip** — emptying an occurrence's `participants`, or untracking one occurrence of a series, writes a file that re-inherits the old value from `defaults:` on the next load, so the change survives in the store until reload and then quietly reverts. The single biggest structural theme is that **`collapse.ts` is a lossy projection that only the store's in-memory shape can see through**: anything the store cannot represent (a cleared inherited field, metadata on an excluded instance, a key on a node with no `StoreItem` home) is dropped at serialization time, and because the store keeps holding the correct value until the next reload, *no user-visible symptom ever coincides with the moment of loss*. The sync layer is otherwise in genuinely good shape — CAS is enforced by both writable backends, `planReconcile`'s decision table is fully enumerated by tests, and the in-flight/`markPushed`/`applyRemoteBatch` guards against mid-flight edits all hold up under direct probing. The damage is concentrated in the two error paths sync tests never enter, and in the model layer's collapse projection.

---

## 2. Coverage statement

### Probed with real reproductions

| Invariant | How |
|---|---|
| 1 round-trip fidelity | 12 adversarial hand-authored files through `parseToStoreItems` → `collapseToYaml` → `saveFile`, comparing against the **source**, not against Meridian's own output |
| 2 edit locality | `applyEdit` at all four scopes on a series with a `defaults:` block and an override; `excludeOccurrence`; `deleteFollowing` |
| 3 expansion ↔ collapse | drove the three hoisting branches (flat single, single-series-with-instances, container) with clear-a-field and exclude-an-instance edits |
| 4 no lost update | real `syncToBackend()` against a fake `StorageBackend`, with an injected failure on the conflict-copy write and with the file deleted remotely |
| 5 cache coherence | reconcile cycles with clock control (`vi.setSystemTime`) over 4 sync ticks |
| 7 recoverability | `beginSwipeDelete` + Undo under jsdom with the real store, toasts and fake persistence |
| 8 temporal | biweekly `byweekday` expansion at `weekStart` ∈ {0,1,6}; a daily 02:30 series across the Europe/Berlin spring-forward (`TZ=Europe/Berlin`); a monthly series anchored on the 31st |

### Reasoned about statically only

- **Invariant 6 (durability)** beyond the conflict path. `writeEntity` is fire-and-forget (`src/storage/index.ts:5`, `void writeEntityToCache(slug)`); the window between `setData` and the Dexie write landing is real but I did not build a kill-the-tab harness. `pagehide` + `visibilitychange` flushes are wired (`src/routes/__root.tsx:62-66`) and tested.
- **Two tabs of the same vault.** There is no `BroadcastChannel`, `storage` event, or Dexie observable anywhere in `src/` (searched `BroadcastChannel|addEventListener\('storage'|liveQuery`— zero hits). Tab B's in-memory store never learns about Tab A's edits, so B's next `writeEntityToCache` collapses from a stale store and overwrites A. **Unverified** — settling it needs a two-store harness, which the current test-utils don't support.
- **IndexedDB quota / `QuotaExceededError`.** Never handled: `recordLocalEdit`'s rejection is caught by `writeEntityToCache`'s `catch` → `notifyError('Save failed', e)`, so it is loud, but the edit is then only in memory with no retry. **Unverified.**

### Skipped, with reason

- **Live local-FS and GitHub backends.** As the brief anticipated: the automated browser cannot grant File System Access permission or complete the GitHub OAuth flow. Both were read end to end and compared against `backend.ts`'s contract statically, and exercised through `fs.test.ts` / `githubBackend.test.ts`. `LocalBackend` itself has **0% coverage** (it is a pure delegation shell over `fs.ts`).
- **The `meridian_bigvault` generator.** Not used. Nothing in the findings is volume-dependent; the one scale-sensitive path (`LARGE_RECONCILE_THRESHOLD` routing through `readAll`) already has a 51-file test in `sync.test.ts`.
- **`fast-check` dry run.** Not installed, and I did not add it — see the verdict on that suspect below.

### Backends: exercised vs traced

| Backend | Status |
|---|---|
| Fake in-memory `StorageBackend` (mirrors GitHub's PUT-without-sha-is-a-create semantics) | **exercised** — drove the real `syncToBackend`/`reconcileWithBackend` |
| `ExampleBackend` | **exercised** by the app's own suite; `readOnly = true` so no write path exists |
| `LocalBackend` / `fs.ts` | **traced** + its own unit tests; CAS logic in `diskWrite`/`diskDelete` read line by line |
| `GitHubBackend` / `githubApi.ts` | **traced** + its own unit tests |

Vaults used: the 16-file shipped Tutorial vault (`exampleBackend.ts`), the 18 `src/model/__tests__/fixtures/*.md`, and ~15 hand-written adversarial files created for this pass.

### Quality gates (single run each)

| Gate | Result |
|---|---|
| `pnpm run build` | **PASS** (exit 0) |
| `pnpm run lint` | **PASS** — 0 errors, 14 pre-existing warnings (all `react-hooks/incompatible-library` on TanStack Virtual/Router) |
| `pnpm test` | **PASS** — 75 files, 926 tests |
| `pnpm run test:coverage` | **PASS** — all thresholds met. Totals 61.69% stmts / 58.19% branch / 64.02% lines |

Coverage pointers worth acting on (pointers, not findings):

- **`src/storage/cache.ts`: 3.73% statements, 0% branches.** Every real Dexie transaction — `recordLocalEdit`, `markPushed`, `applyRemoteBatch`, `recordLocalDelete`, `confirmDeleted` — is exercised only through **hand-written re-implementations** in `sync.test.ts`'s `vi.mock('@/storage/cache')`. The mock and the real code agree today because someone kept them in sync by hand; nothing enforces it. This is the least-defended integrity-critical file in the repo.
- `src/storage/localBackend.ts`: 0%. `src/model/inheritance.ts`: 67% (the `mergeValue` sum-type / product-dict branches at lines 70 and 75 are never taken).

### Fraction of the integrity-critical surface

Roughly **75–80%**. The parse/serialize pipeline, all four `applyEdit` scopes, the collapse hoisting branches, `planReconcile`, `pushDirty`, `resolveCollision`, `reconcileWithBackend` and the expansion engine were all read end to end and probed. The gaps are the ones named above: real-Dexie behaviour, live backends, multi-tab, and quota.

---

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Round-trip fidelity & edit locality | **findings: #2, #3, #5, #8** |
| 2 | Lost updates & conflict handling | **findings: #1, #4** |
| 3 | Cache coherence & durability | **partially assessed** — `planReconcile`, `markPushed`, `applyRemoteBatch` and the in-flight registry were probed and are clean; multi-tab and IndexedDB quota were reasoned about only (see coverage statement) |
| 4 | Atomicity & partial failure | **findings: #1, #4** — `markInFlight`/`clearInFlight` pairing was checked at every call site and is `finally`-guarded; `applyRemoteBatch` is a single Dexie transaction |
| 5 | Destruction & recoverability | **findings: #3, #7** |
| 6 | Temporal correctness | **findings: #6** — DST, month-end overflow, leap-day and count-vs-window independence were all probed and are correct |
| 7 | Input validation & untrusted files | **clean** — a malformed file fails per-file with a user-visible toast (`reportParseFailures`), its slug is reserved via `unreadableSlugs` so a new entry cannot overwrite it, and `titleToSlug` collisions are resolved with a `-2`/`-3` suffix. This is genuinely well built. (The nested-node key drop is filed under round-trip as #5.) |

---

## 4. Verdicts on the brief's "known suspects"

| Suspect | Verdict |
|---|---|
| `collapseToYaml` is "the most compact object that round-trips back to the same store state" | **Confirmed false**, three ways: #2 (a cleared inherited field does not round-trip), #3 (an excluded instance's metadata does not round-trip), #5 (a key with no `StoreItem` home does not round-trip). The three hoisting branches themselves are correct — `hoistSharedMetadata`/`computeSharedFields`/`diffMetadata` hoist and diff soundly, including `deepEqual` on nested unknown values. The claim fails on *what reaches* the hoisting, not on the hoisting. |
| Unknown / hand-authored frontmatter | **Mostly refuted, one real hole.** Unknown keys, explicit `null`, empty lists, nested mappings, and known-fields-with-wrong-types all survive — `unknown-keys.test.ts` and `extras-preservation.test.ts` are thorough and the `extra`-bag design works. The hole is #5: `title`/`tags`/`items` on a non-root node, and *all* keys on an intermediate container node, are filtered out by `RESERVED_KEYS` / dropped by the container branch and land nowhere. Comments, anchors/aliases, key order and quoting are lost — deliberately, per `AGENTS.md`. |
| `src/model/AGENTS.md` has drifted | **Confirmed**, and worse than the brief guessed. The layering table still points at `src/meridian.ts` and `src/App.tsx` (neither exists). `nodeSchema.ts` is described as holding a **Zod schema** — it is 11 lines of `type RawNode`, with no Zod anywhere in `package.json`; there is no validation layer at all. `storeItems.ts` is documented as exporting `parseYamlToStoreItems` — it doesn't. Against that, the *invariants* in the "Unknown-key preservation" section held up under adversarial probing, and its "Deliberate non-goals / still-open losses" paragraph honestly pre-declares #3, #5 and #8. The docs are stale on structure but honest on semantics. |
| No property-based testing | **Refuted as a priority.** I found all eight findings with hand-authored examples, and none of them would have been caught by a generator over well-formed store states: #2, #3 and #5 are all cases where the *input space the generator would sample from* (valid `StoreItem[]`) already excludes the shape that breaks. `fast-check` over `StoreItem[] → collapse → parse → StoreItem[]` would be a genuine ratchet for the hoisting algorithm — which is the part that is already correct. **Recommendation: don't install it yet.** Fix #2/#3/#5 first, then, if you want the ratchet, generate *source YAML* (not store states) and assert set-containment of key/value pairs, which is the assertion `collectKeyValues` already implements. |
| `planReconcile` tests only happy paths | **Refuted.** `reconcile.test.ts` enumerates 16 cases across all four decision branches: never-seen, version-drift, dirty + remote-changed, tombstone + still-listed, skipPaths for just-pushed/just-created/just-deleted, vanished-file drops for clean/dirty/tombstone, and four grace-window boundary cases including the exact boundary. This is the best-tested code in the survey. What *isn't* tested is `resolveCollision` — the function `planReconcile` hands off to — which is where #1 and #4 both live. |

---

## 5. Findings

### Summary table

| # | Finding | Invariant | Failure | Impact | Breadth | Model |
|---|---|---|---|---|---|---|
| 1 | `resolveCollision` reverts the cache before the copy is safe | 4, 6, 7 | **silent** | 9 | 1 fn, all backends, every conflicting write | Sonnet 5 (with the ordering constraint stated) |
| 2 | Clearing an inherited field silently reverts on reload | 1, 2, 3 | **silent** | 7 | every file with a `defaults:` block | Opus 5, plan mode / multi-PR |
| 3 | Excluding an occurrence discards everything on it | 1, 2, 7 | **silent** | 7 | 1 line, 3 prod callers, every recurring entry | Sonnet 5 |
| 4 | Remote-deleted + local edit ⇒ one conflict copy per sync tick, forever | 4, 5 | **loud, unbounded** | 6 | 1 fn, all backends | Sonnet 5 |
| 5 | Frontmatter on a node with no `StoreItem` home is deleted | 1 | **silent** | 6 | hand-authored multi-event files | Sonnet 5 (with the ownership rule stated) |
| 6 | Biweekly `byweekday` series expand differently per device locale | 8, 2 | **silent** | 6 | `freq: weekly` + `interval ≥ 2` + `byweekday` | Opus 5 |
| 7 | Swipe-delete Undo doesn't restore the wikilinks it removed | 7, 2 | **silent** | 5 | 1 of 2 delete paths | Sonnet 5 |
| 8 | Body whitespace and CRLF rewritten on every save | 1 | **silent** | 3 | **every file, every save** | Haiku 4.5 |

Ranked by `(impact × breadth) ÷ effort` with the scoring guidance's tiebreakers (silent > loud, unrecoverable > recoverable) applied. #1 leads on unrecoverability; #8 ranks high on the raw formula (breadth = all files, effort = 1) and is listed last only because its impact is genuinely small — re-sort freely.

**Sequencing note.** #2, #3 and #5 all land in `src/model/collapse.ts` + `src/types.ts`; do them in the order **#3 → #5 → #2**. #3 is a self-contained change to `serializeChildren`; #5 changes where the parse side routes reserved keys; #2 changes the emit predicates (`inlineFieldEmpty`, `diffMetadata`) and will conflict with both if done first. #1 and #4 both rewrite `resolveCollision` — **do #1 first**, since its reordering is the precondition for #4's "the remote file is gone" branch to be safe.

---

### #1 — `resolveCollision` reverts the local edit before the conflict copy is durable

- **Invariant violated:** 4 (no lost update), 6 (durability of accepted writes), 7 (recoverability). Fires whenever a CAS write conflicts *and* the follow-up conflict-copy write fails — i.e. a network drop, a GitHub rate limit, or an expired token landing in the ~1-second window between the two calls. Both writable backends, any file.
- **Category:** `lost-update` `durability` `atomicity` `recoverability`
- **Failure mode:** **Silent.** `TransientSyncError` is classified as offline, so `runSync` reports `setSyncOffline(true)` and — on a manual sync — toasts *"You're offline — changes are saved locally and will sync when you reconnect."* That sentence is false for this file. A user would notice only by reopening the entry after a reload and finding the other device's version. If the failure is a 401 instead, the toast says "Sync failed" — equally uninformative about the destroyed edit.
- **Impact:** **9**

**Repro.** Starting state — backend holds `task.md` at version `sha1`; another device pushes `REMOTE v2`; our cache holds an unpushed local edit derived from `sha1`:

```
cache:   { path: 'task.md', content: 'MY PRECIOUS LOCAL EDIT', status: 'dirty', version: 'sha1' }
backend: { path: 'task.md', content: 'REMOTE v2', version: 'v1' }
```

Operation sequence: `syncToBackend()`, with the backend configured to throw `TransientSyncError('Failed to fetch')` on any write to a path matching `^task_\d` (the conflict copy).

**Observed:**

```
cache after:      [{ path: 'task.md', content: 'REMOTE v2', status: 'clean', version: 'v1' }]
backend files:    ['task.md']
syncError:        null
syncOffline:      true
cache after a 2nd sync: unchanged — 'MY PRECIOUS LOCAL EDIT' is gone for good
```

**Expected:** the local content is either on the backend as a conflict copy, or still `dirty` in the cache for the next cycle. It must never be in neither place.

Failing regression test (drop into `src/storage/__tests__/sync.test.ts`, which already has the `FakeBackend` and cache-mock wiring; add `failWritesTo` to that class):

```ts
describe('pushDirty — a conflict-copy write that fails must not destroy the local edit', () => {
  it('keeps the local content recoverable when the copy write fails mid-resolution', async () => {
    const backend = new FakeBackend()
    backend.seed('task.md', 'remote v1', 'sha1')
    setActiveBackend(backend)
    await backend.write('task.md', 'REMOTE v2', 'sha1')      // another device pushed first
    seedDirty('fake-vault', 'task.md', 'MY LOCAL EDIT', 'sha1')
    backend.failWritesTo(/^task_\d/)                          // network dies on the conflict copy

    await syncToBackend()

    const copy = backend.listPaths().find(p => p !== 'task.md')
    const cached = cacheStore.get(vp('fake-vault', 'task.md'))
    // The local edit must survive somewhere: either copied out, or still dirty.
    expect(copy ? backend.get(copy)!.content : cached?.content).toBe('MY LOCAL EDIT')
  })
})
```

- **Breadth:** one function, but it gates every conflicting write on every backend. Search: `grep -rn "resolveCollision" src` → 2 hits (definition + the single call in `pushDirty`). Every `.md` file in every writable vault is exposed.
- **Recommended model:** **Sonnet 5 if the task states the ordering constraint explicitly** ("write and verify the conflict copy before `setResolvedClean` touches the original's record; on any failure leave the record `dirty` and rethrow"); **else Opus 5**. The hazard that sets the tier: a naive reorder creates the mirror bug — an orphan conflict copy with no cache record when the *re-read* fails instead — and both `pushed` (which feeds `planReconcile`'s `skipPaths`) and `collisionMerges` (which feeds `mergeChangedIntoStore`) must stay consistent with whichever half completed, or the next reconcile re-pulls stale content over the resolution. It fails silently either way, which is why the constraint has to be in the prompt rather than left to judgement.
- **Evidence** — `src/storage/sync.ts:108-131`:

```ts
  const [fresh] = await backend.readFiles([path])
  if (fresh) {
    await setResolvedClean(vaultId, path, fresh.content, fresh.version)
```

  …and only afterwards:

```ts
  const copy = conflictPath(path, new Date())
  await backend.write(copy, localContent)
```

  `setResolvedClean` is documented in `src/storage/cache.ts:127` as safe precisely because *"the local content has already been copied out to a conflict-copy path first"* — which, in program order, it has not been.
- **Problem:** a conflict resolution that fails halfway leaves the user's unpushed edit in neither the cache nor the backend, while the UI claims it is saved locally.
- **Fix:** write (and confirm) the conflict copy first, then `setResolvedClean` the original; on any error from the copy write, leave the original record `dirty` and rethrow. After the fix the repro's assertion passes via the `dirty` branch on the first cycle and via the copy on the next.

---

### #2 — Clearing a field inherited from `defaults:` silently reverts on reload

- **Invariant violated:** 1 (round-trip fidelity), 2 (edit locality), 3 (expansion ↔ collapse agreement). Every save, on any file whose collapse shape produces a `defaults:` block — which is *every* series with instances, i.e. the shape Meridian itself writes.
- **Category:** `round-trip` `edit-locality`
- **Failure mode:** **Silent, and actively misleading.** The store keeps the cleared value, so the UI shows the change as applied and the sync indicator goes green. The value reappears on the next reload, on another device immediately, and there is no error anywhere. A user would notice as "the app keeps re-adding Bob to my Tuesday standup."
- **Impact:** **7**

**Repro (symptom a — clear on one occurrence).** Starting file `ts.md`, verbatim:

```yaml
---
title: Team Standup
date: 2026-04-06
time: "09:00"
participants: [alice, bob]
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
defaults:
  done: false
instances:
  - date: 2026-04-13
    done: true
---
```

Operation: open the 2026-04-20 occurrence, choose scope **"This event"**, remove both participants, save (`applyEdit(..., 'single', { participants: [] })`).

**Observed** file written:

```yaml
---
defaults:
  done: false
  participants:
    - alice
    - bob
title: Team Standup
date: 2026-04-06
time: 09:00
repeat: {...}
instances:
  - date: 2026-04-13
    done: true
  - date: 2026-04-20
    time: 09:00          # ← no `participants:` key at all
---
```

Re-parsing that file gives **every** occurrence, including 2026-04-20, `participants: ["alice","bob"]`. **Expected:** 2026-04-20 has no participants.

**Repro (symptom b — clear on the whole series).** Same file, scope **"All events"**, remove both participants. Observed output keeps `participants: [alice, bob]` on the 2026-04-13 instance — an "All events" edit that reaches all but one event, because that override's metadata was materialised from the inherited value at parse time and now reads as a divergence.

The same mechanism breaks untracking: scope "This event" + `tracked: false` writes a bare `- date: 2026-04-20, time: 09:00` and the occurrence comes back as a task with `done: false`.

Failing regression test (`src/model/__tests__/`):

```ts
it('clearing an inherited field on one occurrence does not come back on reload', () => {
  const src = [
    '---', 'title: Team Standup', 'date: 2026-04-06', 'time: "09:00"',
    'participants: [alice, bob]',
    'repeat:', '  type: schedule', '  freq: weekly', '  byweekday: [mo]',
    'defaults:', '  done: false',
    'instances:', '  - date: 2026-04-13', '    done: true', '---',
  ].join('\n')
  const p = parseToStoreItems('ts.md', src)
  const roots = new Map([['ts', p.root]])
  const occ = expandRange(p.items, roots, new Date(2026, 3, 1), new Date(2026, 4, 31))
    .find(o => o.date === '2026-04-20')!

  const next = applyEdit({ items: p.items, roots }, occ, 'single', {
    title: 'Team Standup', tags: [], items: [], participants: [],   // ← cleared
    tracked: true, done: false, priority: null,
    scheduled: { date: '2026-04-20', time: '09:00' }, duration: '', repeat: null, body: '',
  })
  const written = saveFile(collapseToYaml(next.items, next.roots.get('ts')), '')

  const reparsed = parseToStoreItems('ts.md', written)
  const after = expandRange(reparsed.items, new Map([['ts', reparsed.root]]),
    new Date(2026, 3, 1), new Date(2026, 4, 31)).find(o => o.date === '2026-04-20')!
  expect(after.metadata.participants).toEqual([])   // observed: ['alice','bob']
})
```

- **Breadth:** all five `OCCURRENCE_FIELDS` are affected in principle; `participants` (the only `required: true` occurrence array) and `done` are the reachable ones today. Search: `grep -l "defaults:" src/model/__tests__/fixtures/*.md | wc -l` → **13 of 18** fixtures, and `grep -c "^defaults:" src/storage/exampleBackend.ts` → **2 of 16** shipped tutorial files, already carry a `defaults:` block. `collapseToYaml` emits one for every single-series-with-instances file, so in a real vault this is roughly "every recurring entry the user has ever overridden".
- **Recommended model:** **Opus 5 in plan mode, for a plan spanning multiple PRs.** This needs a product decision before any code: does a cleared field emit an explicit empty marker (`participants: []`, `done: null`) into the instance, or does collapse stop hoisting a field the moment any item diverges? The hazard that sets the tier: `inlineFieldEmpty` is shared by `occMetaToYaml` *and* `fileMetaToYaml`, so loosening it globally makes every file in every vault grow `participants: []` / `tags: []` / `items: []` on the next save — a whole-vault diff shipped as a bugfix. And symptom (b) is a different decision from symptom (a): whether "All events" should rewrite explicit overrides at all. Both must be settled together or the fix moves the corruption rather than removing it.
- **Evidence** — `src/types.ts:229` makes an empty array indistinguishable from an absent one:

```ts
export function inlineFieldEmpty(kind: InlineFieldKind, v: unknown): boolean {
  if (v === undefined) return true
  return kind === 'stringArray' ? !Array.isArray(v) || v.length === 0 : false
}
```

  `src/model/collapse.ts:189-198` (`occMetaToYaml`) then drops exactly the `[]` that `diffMetadata` at `:223-237` correctly identified as a divergence:

```ts
    const v = (m as Record<string, unknown>)[spec.key as string]
    if (!inlineFieldEmpty(spec.kind, v)) result[spec.key] = v
```

  `src/model/AGENTS.md` already lists *"absent-vs-empty for required arrays"* among its still-open losses — this finding is what that sentence costs in practice.
- **Problem:** an occurrence-level field the user cleared is written as an absent key, so `defaults:` inheritance restores the old value on the next load and the edit is undone without a trace.
- **Fix:** make "cleared" representable — emit an explicit empty/null marker for a field that diverges from its inherited default, and teach `parseInlineField` to read it back as cleared; afterwards the test above passes and the "All events" repro leaves no stale `participants:` on the 2026-04-13 instance.

---

### #3 — Excluding an occurrence discards every field on it

- **Invariant violated:** 1 (round-trip), 2 (edit locality), 7 (recoverability). Fires on every swipe-delete or "This occurrence" delete of a recurring occurrence that carries per-occurrence data, and on every override at or after the cut when "This and following" is used.
- **Category:** `round-trip` `recoverability` `edit-locality`
- **Failure mode:** **Silent.** The store keeps the full metadata after the exclude, so nothing looks wrong; the loss materialises only on the next reload or on the other device. The swipe-delete undo toast lasts 4 seconds and restores from an in-memory snapshot — after that there is no artifact anywhere. The editor's "This and following" path (`deleteFuture`) has no undo toast at all.
- **Impact:** **7**

**Repro.** Starting file `s2.md`, verbatim:

```yaml
---
title: Standup
date: 2026-04-06
repeat:
  type: schedule
  freq: weekly
  byweekday: [mo]
instances:
  - date: 2026-04-13
    done: true
    minutesUrl: https://example.com/notes/13
---
```

Operation: expand, take the 2026-04-13 occurrence, `excludeOccurrence(...)` (exactly what a swipe-delete does), serialize.

**Observed:**

```yaml
---
title: Standup
date: 2026-04-06
repeat:
  type: schedule
  freq: weekly
  byweekday:
    - mo
instances:
  - date: 2026-04-13
    excluded: true
---
```

`minutesUrl` — a URL the user hand-wrote and Meridian promised to preserve — is gone, along with `done: true`. **Expected:** the exclusion stub keeps the child's own fields; only its visibility changes. The same happens for hand-authored excluded children on load: a source file with `excluded: true, cancelReason: public holiday, owner: bob` round-trips to just `date` + `excluded`.

Failing regression test:

```ts
it('excluding an occurrence keeps the unknown keys it carried', () => {
  const src = [
    '---', 'title: Standup', 'date: 2026-04-06',
    'repeat:', '  type: schedule', '  freq: weekly', '  byweekday: [mo]',
    'instances:', '  - date: 2026-04-13', '    done: true',
    '    minutesUrl: https://example.com/notes/13', '---',
  ].join('\n')
  const p = parseToStoreItems('s2.md', src)
  const roots = new Map([['s2', p.root]])
  const occ = expandRange(p.items, roots, new Date(2026, 3, 13), new Date(2026, 3, 13, 23, 59))[0]!

  const next = excludeOccurrence({ items: p.items, roots }, occ)
  const out = saveFile(collapseToYaml(next.items, next.roots.get('s2')), '')

  expect(out).toContain('minutesUrl: https://example.com/notes/13')  // observed: absent
})
```

- **Breadth:** one line of code, three production call sites — `src/occurrenceActions.ts:108` (swipe-delete), `src/editor/save.ts:165` ("This occurrence"), and `src/editor/save.ts:178` (`deleteFollowing`, which sets `excluded: true` on **every** override at or after the cut date in a single action, so its blast radius is N overrides at once). Search: `grep -rn "excludeOccurrence(\|deleteFollowing(" src --include=*.ts --include=*.tsx | grep -v __tests__`.
- **Recommended model:** **Sonnet 5.** The fix is local to `serializeChildren`. The hazard to name in the task: the emitted stub must still be *diffed against the series metadata* (`diffMetadata(c.metadata, seriesMeta)`), not dumped wholesale — dumping re-materialises every inherited value onto every exclusion stub and inflates the file on each delete; and `excluded` must stay in `STRUCTURAL_KEYS` so `emitExtra`'s defensive skip keeps working. With those two sentences in the prompt this is a mechanical edit; without them the plausible-wrong version passes the existing snapshot and grows every recurring file.
- **Evidence** — `src/model/collapse.ts:150`:

```ts
    if (c.excluded) return { date: c.date, ...(c.time ? { time: c.time } : {}), excluded: true }
```

  Note `src/model/__tests__/__snapshots__/edits.test.ts.snap` bakes this shape in at four places (e.g. `- date: 2026-04-20 / time: 09:00 / excluded: true`) — but every fixture there excludes a *generated* occurrence with nothing to lose, so the snapshot is defending a case that has never carried data. That is exactly the "snapshot asserts stability, not correctness" trap the brief flagged.
- **Problem:** deleting one occurrence of a series erases the notes, links and overrides the user attached to that occurrence, with a 4-second undo window and no recoverable artifact after it.
- **Fix:** emit the excluded child's diffed metadata alongside `excluded: true` in `serializeChildren`; afterwards the test above passes and the hand-authored `cancelReason`/`owner` case round-trips.

---

### #4 — A remotely-deleted file with a pending local edit spawns a new conflict copy every sync tick, forever

- **Invariant violated:** 4 (no lost update), 5 (cache coherence). Fires when a file is deleted or renamed on the other device — or by hand, or by `git rm` in a GitHub vault — while the local cache still holds an unpushed edit for it.
- **Category:** `lost-update` `cache-coherence` `atomicity`
- **Failure mode:** **Loud, but unbounded and non-converging.** Each cycle raises one `warn` toast ("Conflict on task.md — your version saved as …") and creates one new file; the dirty badge never clears because `task.md` stays `dirty` forever. The user's content is never lost, but the vault fills with duplicates at one per `autoSyncTick` (60 s ⇒ ~1440 files/day), each of which is itself a `.md` vault entry that gets parsed into the store and pushed to the backend.
- **Impact:** **6**

**Repro.** Starting state — the cache holds a dirty record whose base version refers to a file the backend no longer has (deleted on another device):

```
cache:   { path: 'task.md', content: 'local edit', status: 'dirty', version: 'sha1' }
backend: (empty)
```

Operation: four `syncToBackend()` calls, 61 seconds apart (`vi.useFakeTimers({ toFake: ['Date'] })` + `vi.setSystemTime`).

**Observed:**

```
backend paths: [ 'task_20260731-080000.md', 'task_20260731-080101.md',
                 'task_20260731-080202.md', 'task_20260731-080303.md' ]
cache:         task.md → dirty (still, with the stale 'sha1'), plus 4 clean copies
syncError:     null
```

Four identical copies of the same content, and `task.md` unchanged. **Expected:** one cycle resolves it — either the local content is re-created at `task.md` (a create, since the remote is gone) or exactly one conflict copy is made and the record stops being dirty.

Two conflicts on the *same* path inside one second is a related second-order bug: `conflictPath` returns the same name, the copy write hits an existing file, and the resulting `ConflictError` escapes `resolveCollision` past `pushDirty`'s `catch (e) { if (e instanceof ConflictError) … }` — where it is re-classified as an actionable failure. Observed: `syncError = "Conflict on a_20260731-082303.md: backend version diverged since last sync."`

- **Breadth:** one function, all backends. Any vault touched by a second device, a hand-rename, or a `git rm`.
- **Recommended model:** **Sonnet 5.** The hazard: the obvious fix — "if the re-read returns nothing, push the local content as a create" — must **clear the record's stale `version` first**, or the very next CAS presents `sha1` against an absent file and reproduces the conflict immediately; and it must not silently resurrect a file the other device deliberately deleted, so the user needs telling which of the two happened. Naming those two constraints makes this a Sonnet job; without them the plausible fix looks correct and loops just as hard.
- **Evidence** — `src/storage/sync.ts:107-131`: the `if (fresh)` guard means the dirty record is simply left untouched when the remote file is gone, while the copy is written unconditionally below it:

```ts
  const [fresh] = await backend.readFiles([path])
  if (fresh) {
    await setResolvedClean(vaultId, path, fresh.content, fresh.version)
```

  and the copy write carries no precondition and no collision retry:

```ts
  const copy = conflictPath(path, new Date())
  await backend.write(copy, localContent)
```
- **Problem:** a file deleted on one device while edited on another wedges sync permanently and litters the vault with one duplicate entry per minute.
- **Fix:** handle the "remote is gone" case explicitly — clear the record's base `version` and re-push it as a create (or tombstone it, with a toast saying which) — and make the copy write collision-tolerant by bumping the timestamp/suffix on `ConflictError`; afterwards the four-cycle repro produces at most one extra file and ends with no dirty records.

---

### #5 — Frontmatter on a node the parser gives no `StoreItem` home is silently deleted

- **Invariant violated:** 1 (round-trip fidelity). Hand-authored files only, on the first save after the file is edited through the app.
- **Category:** `round-trip` `validation`
- **Failure mode:** **Silent.** No parse error, no toast; the file loads, the keys are simply absent from the store and therefore from the next write. A user would notice as "Meridian ate my per-event titles" in a `git diff`, possibly weeks later.
- **Impact:** **6**

**Repro (a) — file-level keys on a child node.** Starting file, verbatim:

```yaml
---
instances:
  - date: 2026-01-01
    title: Meeting A
  - date: 2026-01-02
    title: Meeting B
---
```

Operation: `parseToStoreItems` → `collapseToYaml` → `saveFile` (the exact `writeEntityToCache` path).

**Observed:**

```yaml
---
title: ""
instances:
  - date: 2026-01-01
  - date: 2026-01-02
---
```

Both titles deleted, and an empty one invented at the root. **Expected:** the titles survive somewhere — even if Meridian's model insists `title` is file-level, the bytes should be preserved under their own key, exactly as `project:`/`url:`/`aliases:` already are.

**Repro (b) — any key on an intermediate container node.** Starting file:

```yaml
---
title: Trip
instances:
  - project: apollo
    reviewer: alice
    instances:
      - date: 2026-01-01
      - date: 2026-01-02
---
```

**Observed:** `project` and `reviewer` are gone; output is `title: Trip` + the two bare dates. Same for a `defaults:` block nested inside an instance: `defaults: { tags: [work], owner: alice }` loses `tags` and keeps only `owner`.

Failing regression test:

```ts
it('keeps file-level keys written on a child node', () => {
  const src = [
    '---', 'instances:',
    '  - date: 2026-01-01', '    title: Meeting A',
    '  - date: 2026-01-02', '    title: Meeting B', '---',
  ].join('\n')
  const p = parseToStoreItems('c.md', src)
  const out = saveFile(collapseToYaml(p.items, p.root), p.root.body ?? '')
  expect(out).toContain('Meeting A')   // observed: absent
  expect(out).toContain('Meeting B')   // observed: absent
})
```

- **Breadth:** two distinct holes. (a) the three `level: 'file'` registry keys — `title`, `tags`, `items` — on any non-root node; (b) *all* keys on a container node. Search: `grep -rn "unknownKeys(" src` → 2 call sites, `types.ts:215` (definition) and its uses in `extractFileMetadata`/`extractOccurrenceMetadata`; the container branch is `src/model/storeItems.ts:125-127`. Affects any hand-written file that groups several dated events under one root — a natural shape given the model, and the shape the `irregular-instances` fixture itself uses.
- **Recommended model:** **Sonnet 5 if the task spells out the ownership rule** from `src/model/AGENTS.md` ("the root is an item, or the file owns it, never both" — a reserved key with no home *at this level* belongs in that node's `extra`); **else Opus 5**. The hazard: routing `title` into an occurrence `extra` bag naively makes `fileMetaToYaml`'s `if (root.extra && spec.key in root.extra) continue` short-circuit prefer the stale raw value over the typed root title, and if the root *is* the item the key then emits twice — the exact double-emission the `unknown-keys.test.ts` "emits date exactly once" test was written to catch. Hole (b) needs a place to hang a container's remainder at all, which is a small structural addition.
- **Evidence** — `src/types.ts:187` filters by the union of both levels, while `extractOccurrenceMetadata` only ever stores the occurrence half:

```ts
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...STRUCTURAL_KEYS,
  ...INLINE_FIELDS.map(s => s.key as string),
])
```

  and `src/model/storeItems.ts:125-127` walks past a container without collecting anything:

```ts
    } else {
      n.instances.forEach(walk)  // container node
    }
```
- **Problem:** a hand-authored file that puts a title (or any key) on a nested node loses those bytes the first time Meridian saves it, despite the README promising hand-created files are picked up.
- **Fix:** route reserved keys with no home at the current level into that node's `extra` bag, and give container nodes a remainder home; afterwards both repros round-trip their keys and the "emits `date` exactly once" test still passes.

---

### #6 — A biweekly `byweekday` series expands to different dates depending on the reader's locale

- **Invariant violated:** 8 (temporal correctness) always; 2 (edit locality) as soon as one device writes an override. Two devices with different `Intl` locales, or one device whose locale changes.
- **Category:** `temporal` `edit-locality`
- **Failure mode:** **Silent.** Both devices render a perfectly plausible schedule; they just disagree about which days it falls on. A user would notice as "my sprint review shows on the 19th on my laptop and the 12th on my phone."
- **Impact:** **6**

**Repro.** Starting file `sr.md`, verbatim:

```yaml
---
title: Sprint review
date: 2026-04-02
repeat:
  type: schedule
  freq: weekly
  interval: 2
  byweekday: [su]
---
```

Operation: `expandRange(items, roots, 2026-04-01, 2026-05-31, weekStart)` for each locale value.

**Observed** — no overlap after the anchor:

| `weekStart` | locale | dates |
|---|---|---|
| 1 | de-DE, en-GB (Monday first) | `04-02, 04-05, 04-19, 05-03, 05-17, 05-31` |
| 0 | en-US (Sunday first) | `04-02, 04-12, 04-26, 05-10, 05-24` |
| 6 | ar-SA (Saturday first) | `04-02, 04-12, 04-26, 05-10, 05-24` |

Control: the same file with `interval: 2` removed gives identical dates at every `weekStart`, so the divergence is specific to `interval ≥ 2`.

The divergence then gets written into the file. On the Monday-first device, mark the 2026-04-19 occurrence done → the file gains:

```yaml
instances:
  - date: 2026-04-19
    done: true
```

Re-reading that file on the Sunday-first device **observes** an extra occurrence at 2026-04-19 with `source: 'explicit'` that is not part of its schedule at all — a phantom event sitting between the 12th and the 26th. **Expected:** one file, one schedule, one set of dates, everywhere.

Failing regression test:

```ts
it('a biweekly byweekday series yields the same dates regardless of locale week start', () => {
  const src = [
    '---', 'title: Sprint review', 'date: 2026-04-02',
    'repeat:', '  type: schedule', '  freq: weekly', '  interval: 2',
    '  byweekday: [su]', '---',
  ].join('\n')
  const p = parseToStoreItems('sr.md', src)
  const roots = new Map([['sr', p.root]])
  const from = new Date(2026, 3, 1), to = new Date(2026, 4, 31)
  const mon = expandRange(p.items, roots, from, to, 1).map(o => o.date)
  const sun = expandRange(p.items, roots, from, to, 0).map(o => o.date)
  expect(sun).toEqual(mon)   // observed: ['2026-04-02','2026-04-12',…] vs ['2026-04-02','2026-04-05',…]
})
```

- **Breadth:** `freq: weekly` + `interval ≥ 2` + a `byweekday` list. `weekStart` reaches expansion from `weekStartsOn(localePrefs)` at four call sites — `src/calendar/useExpandWithMultiday.ts:49`, `src/routes/_app.entry.$slug.tsx:56`, `src/store.ts:161`, and `src/fileOccurrence.ts:123` — and `localePrefs.firstDayOfWeek` is auto-detected per device from `Intl.Locale.getWeekInfo()` (`src/store.ts:11-12`) into per-device localStorage.
- **Recommended model:** **Opus 5.** The hazard that sets the tier: the correct answer is to derive the week grouping from the series **anchor** (or to persist a `wkst` in the repeat block, RFC 5545's answer) rather than from the reader — but *any* change here re-dates every existing biweekly series in every user's vault, so it needs a migration decision, and `weekStart` must keep coming from the locale for *view* layout (`MonthView.tsx:34`, `DatePickerDialog.tsx:78`). The specific trap: "just hardcode Monday" is correct in the author's locale and silently wrong in the US — the same class of fix that voids itself. `src/model/__tests__/weekStart.test.ts` currently pins **both** behaviours as intended, so the fix also has to argue with an existing test rather than just make it pass.
- **Evidence** — `src/model/expansion.ts:241-243`, inside `matchesInPeriod`'s weekly branch:

```ts
        const wd = periodStart.getDay()
        const weekStartOff = -((wd - weekStart + 7) % 7)
        const periodWeekStart = new Date(periodStart)
```

  With `interval ≥ 2` the period cursor advances 14 days, so which fortnight a `byweekday` day falls into depends entirely on where the reader's week boundary sits.
- **Problem:** the same vault file describes two different schedules on two devices, and an override written on one appears as a phantom extra occurrence on the other.
- **Fix:** ground the `byweekday` week on the series anchor (or a persisted `wkst`) instead of the viewer's `localePrefs`, with a migration note; afterwards the test above passes and the cross-device override lands on a real generated slot on both devices.

---

### #7 — Swipe-delete's Undo restores the entry but not the wikilinks it removed

- **Invariant violated:** 7 (recoverability), 2 (edit locality). Swipe-deleting a standalone entry that other notes link to.
- **Category:** `recoverability` `edit-locality` `cache-coherence`
- **Failure mode:** **Silent.** After Undo the entry is back and looks intact; the linking note's `items` list is empty in the store while the file on disk still has the link. Nothing warns. The user notices when the linking note's Items section is short a row — or never, until they edit that note and the link is written out of the file for real.
- **Impact:** **5**

**Repro.** Store state: `note-a` (a standalone occurrence) and `note-b` whose root carries `items: ['[[note-a]]']`.

Operation: `beginSwipeDelete(occA)`, run the returned apply function, then click **Undo** before the 4 s toast closes.

**Observed:**

```
after delete:  note-b items = []      writes = []        deletes = []
after undo:    note-b items = []      writes = ['note-a'] deletes = []
```

**Expected:** `note-b items = ['[[note-a]]']` after Undo. Two separate defects show here: the backlink removal is never persisted in the first place (`writes` never contains `note-b`, unlike the editor's own delete path), and Undo never restores it.

Failing regression test (`src/occurrenceActions.test.tsx` style — that file already has `setupStore`/`installFakePersistence`/`makeOcc`/`makeRoots`):

```ts
it('Undo restores the wikilink the delete removed from another file', () => {
  const a = makeOcc({ id: 'occ-a', fileSlug: 'note-a', metadata: { participants: [], title: 'A', tags: [], items: [] } })
  const b = makeOcc({ id: 'occ-b', fileSlug: 'note-b', metadata: { participants: [], title: 'B', tags: [], items: ['[[note-a]]'] } })
  const roots: Roots = makeRoots('note-a', { title: 'A' })
  roots.set('note-b', { title: 'B', tags: [], items: ['[[note-a]]'] })
  seedStore([a, b], roots)
  render(<Toaster />)

  const apply = beginSwipeDelete(a)
  act(() => apply())
  act(() => { vi.advanceTimersByTime(20) })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

  expect(useStore.getState().roots.get('note-b')?.items).toEqual(['[[note-a]]'])  // observed: []
})
```

- **Breadth:** one of the two delete paths. The editor's delete does it correctly — `src/editor/save.ts:171-173` and `:185-187` both compute `getBacklinks().get(item.fileSlug)` and route through `commitDelete(next, slug, affected)`, which persists the backlink files. The swipe path skips both.
- **Recommended model:** **Sonnet 5.** The hazard: the fix must restore the *other* files' roots as well as the deleted slug's, and persist them — but a blanket "restore the whole snapshot" reintroduces the bug `src/occurrenceActions.test.tsx`'s existing test *"undoing a delete does not revert an unrelated edit made during the toast window"* was written to prevent. The restore has to be scoped to exactly the backlink slugs the delete touched, which is the same set `commitDelete` already takes.
- **Evidence** — `src/occurrenceActions.ts:124-126` mutates other files' roots but persists only the deleted slug:

```ts
    return () => {
      if (!cancelled) setData(deleteByFileSlug(getSnapshot(), o.fileSlug))
    }
```

  while `restoreFileSlug` at `:18-30` is scoped to one slug by construction:

```ts
  const roots = new Map(current.roots)
  const snapshotRoot = snapshot.roots.get(fileSlug)
  if (snapshotRoot) roots.set(fileSlug, snapshotRoot)
```
- **Problem:** undoing a swipe-delete leaves other notes missing the wikilink they carried to the restored entry, and the next edit to those notes writes that loss to disk.
- **Fix:** have `beginSwipeDelete` pass the backlink slugs through `commitDelete`, and have the undo path restore and re-persist those same slugs; afterwards the test above passes and `writes` contains `note-b` on both the delete and the undo.

---

### #8 — Body whitespace and CRLF rewritten on every save

- **Invariant violated:** 1 (round-trip fidelity). Every save of every file; the CRLF half hits every vault authored on Windows or synced through a tool that normalises to CRLF.
- **Category:** `round-trip`
- **Failure mode:** **Silent.** No error; the content is semantically identical. The user notices as a whole-file `git diff` on a one-character edit, or as lost indentation on a body that started with an indented code block.
- **Impact:** **3**

**Repro.** Three inputs, verbatim, through the production write path:

| In | Out |
|---|---|
| `"---\ntitle: A\n---\n\n  indented start\n\ncode:\n\n```\n  x = 1\n```\n\n\n"` | `"---\ntitle: A\n---\n\nindented start\n\ncode:\n\n```\n  x = 1\n```"` — leading indentation and the trailing newline gone |
| `"---\r\ntitle: A\r\ndate: 2026-01-01\r\n---\r\n\r\nline1\r\nline2\r\n"` | `"---\ntitle: A\ndate: 2026-01-01\n---\n\nline1\r\nline2"` — frontmatter converted to LF, body left CRLF ⇒ **mixed line endings** |
| `"# Hello\n\nSome notes.\n"` (a plain `.md` with no frontmatter — a README, a note from another tool) | `"---\ntitle: \"\"\n---\n\n# Hello\n\nSome notes."` — gains an empty-title frontmatter block |

**Expected:** at minimum, the file's dominant line ending is preserved and the trailing newline is kept. The CRLF case is the one worth fixing: converting to LF *or* keeping CRLF would both be defensible; producing a mixed file is the one outcome that is strictly worse than either.

- **Breadth:** every `.md` file in every vault, on every save. Search: `grep -rn "wrapFrontmatter\|splitFrontmatter" src` → `src/fileIO.ts` only, with `saveFile` (`src/model/inheritance.ts:210`) as the sole writer, called from `src/storage/sync.ts:588`.
- **Recommended model:** **Haiku 4.5.** Purely mechanical: record the source's line ending and trailing-newline convention on the `FileMetadata` root, and re-apply it in `wrapFrontmatter`. The hazard is small and loud: if the round-trip is wrong the existing `yaml-roundtrip.test.ts` fixed-point tests fail immediately, which is the safe failure mode. (Add a CRLF fixture — there is none today, which is why this has never been caught.)
- **Evidence** — `src/fileIO.ts:25` trims the body unconditionally:

```ts
  if (m) return { fm: m[1]!, body: m[2]!.trim() }  // both groups are mandatory
```

  and `src/fileIO.ts:30-32` re-emits with hard-coded LF and no trailing newline:

```ts
export function wrapFrontmatter(yamlFields: string, body: string): string {
  return `---\n${yamlFields}\n---${body ? '\n\n' + body : ''}`
}
```
- **Problem:** every save rewrites bytes the user did not change — indentation on the first body line, the trailing newline, and every `\r` in the frontmatter — turning a one-field edit into a whole-file diff on Windows-authored vaults.
- **Fix:** carry the source line ending and trailing-newline convention through `loadFile` → `FileMetadata` → `wrapFrontmatter`, and trim only the blank lines around the frontmatter fence rather than the whole body; afterwards all three repro inputs round-trip byte-identically when nothing changed.

---

## 6. Things checked and found sound

Worth recording so the next pass doesn't re-derive them:

- **CAS is real on both writable backends.** `fs.ts`'s `diskWrite` treats `undefined` as "must be absent" (`if (cur !== expectedVersion) throw new ConflictError(path)`), and `diskDelete` mirrors it while staying idempotent for an already-absent file. `githubBackend` passes `expectedVersion` as the `sha` and never falls back to its own `_shas` cache for writes. `mapGitHubError` maps 409/422 → `ConflictError`, 403-with-rate-limit-headers → transient rather than auth. `statAll` refuses a truncated tree listing rather than reading it as a mass deletion.
- **`markPushed`, `applyRemoteBatch` and the in-flight registry** all correctly refuse to clean-stamp a record a local edit touched mid-flight; I re-ran the existing probes and could not break them.
- **DST.** A daily 02:30 series across the Europe/Berlin spring-forward keeps `date: 2026-03-29` and `time: "02:30"` in the model; only `jsTime`'s wall clock shifts to 03:30 (the hour that does not exist), which affects Day-view placement, not the stored day. **No occurrence moves days.**
- **Month-end and leap days.** A monthly series anchored on the 31st correctly skips short months rather than overflowing (`01-31, 03-31, 05-31, 07-31, 08-31, 10-31, 12-31`); a Feb-29 yearly anchor skips non-leap years.
- **Window-independence.** `end: { type: 'count' }` enumerates from the anchor and clips at the end, so the same rule yields the same occurrences whatever range is queried — the skip-ahead optimisation is correctly gated on `maxCount === Infinity`.
- **`stableOccId` and duplicate dates.** Two instances on the same date get distinct `#2` suffixes at parse time (`storeItems.ts`'s `usedKeys` counter) and each keeps its own metadata through the round-trip; `expandNode`'s `findOverrides` returns every match rather than the first.
- **Malformed input.** A file with bad YAML fails individually, raises a `warn` toast, and reserves its slug via `unreadableSlugs` so a new entry cannot be written over it. Verified with duplicate keys, tab indentation, and unquoted colons.

## 7. Smaller observations (not findings — no byte lost)

- **`applyFuture` on a count-bounded series silently changes the total.** Splitting a 10-occurrence series at its third occurrence caps the first at `until: 2026-04-19` but copies `end: { type: count, occurrences: 10 }` verbatim onto the new one — total goes 10 → 12 (verified). Not a byte lost, but "this and following" changes the schedule's meaning.
- **"Remove repeat" does nothing to an existing series.** `useEntryDialogs.ts:74` sets `repeat: null`, but `applyFieldsToItem` does `repeat: repeat ?? item.repeat` (`storeOps.ts:291`), so a scope-`all` save keeps the old rule. Verified: the file is unchanged.
- **`timezone` is a registered, parsed, round-tripped field that nothing reads.** `grep -rn "timezone" src` → 4 hits, all declarations. A user writing `timezone: America/New_York` gets no effect; every time is floating wall-clock. Probably the right product choice, but the field is a trap as it stands.
- **`parseDurationDays` treats a month as 30 days and a year as 365** for multiday span rendering — a "2 months" event always covers exactly 60 days.
- **`src/model/AGENTS.md` needs a pass** — see the suspects table above.
