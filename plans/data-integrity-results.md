# Data Integrity & Durability — survey results

Run 2026-09-05 against `main` (`47f601b`). Survey: [`surveys/data-integrity.md`](surveys/data-integrity.md);
shared conventions: [`surveys/README.md`](surveys/README.md).

**Finding numbers restart at #1 for this run.** The `#N` references appended to
the "Known suspects" entries in the survey file before 2026-09-05 belong to the
2026-07-31 run, whose results file was deleted when its last finding closed.
Code comments citing "data-integrity survey, finding #N" likewise refer to that
earlier run; they have not been renumbered.

---

## 1. Integrity verdict

Yes — Meridian can lose the user's writing. The worst still-open case is a
**malformed structural key**: a hand-written `date:`, `excluded:` or
`instances:` in a shape the parser can't type has no `extra` home and is
silently deleted on the next save, in one case reviving an occurrence the user
had deliberately hidden (finding #4).

(Two of the run's worst findings are now fixed: an editor save deleting
unrelated hand-authored frontmatter — `tags`/`done`/`priority` the model can't
type — on every save regardless of what was actually edited (finding #1); and
a second view of the same vault silently overwriting the first with its
compare-and-swap intact (finding #2) — cache writes are now announced across
views and folded back into each one's store, and an open editor adopts what it
did not touch and reports what both sides moved.)

The single biggest structural theme is that **the round-trip guard checks the
wrong round trip**. `roundTripLoss` is sound only on an *unedited* file (its own
doc comment says so), so an edit's own losses stay invisible to the one runtime
check that exists to find the next one. Its other half — comparing parsed values
rather than bytes — is fixed: unknown keys are now compared by source text, and
finding #6's re-derived scalars, which that change made visible, are now
preserved rather than merely reported.

---

## 2. Coverage statement

**Invariants probed with real reproductions** (a failing test was written and
run, and is quoted in the finding):

| Invariant | Probed how |
|---|---|
| 1 round-trip fidelity | 39 adversarial frontmatter shapes through `parseToStoreItems` → `serializeEntry`, plus all 20 `model/__tests__/fixtures/*.md` |
| 2 edit locality | No-op save of every fixture × 3 scopes (`all`/`single`/`future`) × first 3 occurrences (60 combinations), diffed against the unedited serialization |
| 4 no lost update | Two-tab write sequence against the **real** Dexie cache (`fake-indexeddb`) plus a hand-rolled CAS backend |
| 5 cache coherence | Same harness; plus a static trace of `hydrateFromCache` / `planReconcile` to establish that no later reconcile can repair the stale tab |
| 6 durability | `useAutoSave` under jsdom with fake timers, driven to `pagehide`/`visibilitychange` |
| 8 temporal correctness | Differential expansion across 9 timezones (UTC, America/New_York, Europe/Berlin, America/Santiago, Australia/Lord_Howe, Pacific/Chatham, Pacific/Auckland, Asia/Tehran, Antarctica/Troll) × 13 repeat rules × 6 anchors × 4 times; then a 48-time-of-day sweep asserting daily continuity (366 distinct days) and exact `count` cardinality for daily/weekly/monthly/yearly |

**Reasoned about statically, not reproduced:**

- Invariant 3 (expansion ↔ collapse agreement) beyond what the fixture no-op
  sweep covers. `computeSharedFields` / `occMetaToYaml` / `emitExtra` were read
  end-to-end and the hoisting logic looks sound; the losses found sit *upstream*
  of it, in what reaches collapse at all.
- Invariant 7 (recoverability) — the delete-undo toast, `deleteFollowing`,
  `excludeOccurrence`, the staged cross-vault move and the retention sweep's
  undo were all read end-to-end. `moveEntry.ts`/`pendingMoves.ts`'s
  stage-then-release ordering holds up; `retentionDays` is opt-in (blank by
  default in `VaultSettings.tsx:94`), so the bulk archive sweep never fires
  unasked. Nothing reproduced. The one recoverability-adjacent defect found is
  finding #4's `excluded:` deletion.

**Skipped, with the reason:**

- **Atomicity / partial failure (category 4).** Interrupting a Dexie
  `bulkPut` mid-transaction, or `persistEntries` mid-loop, needs a fault-injection
  harness the current test-utils don't offer. Traced statically only — see
  "unverified" below.
- **IndexedDB quota exhaustion.** `fake-indexeddb` does not enforce a quota, so
  `QuotaExceededError` handling could not be exercised.

**Backends.** Exercised for real: the model layer, and `storage/cache/` through
the genuine Dexie code on `fake-indexeddb`. `localBackend`/`fs.ts`,
`githubBackend`/`githubApi`, `exampleBackend` and `icalBackend` were **traced
statically** and read against the `StorageBackend` contract — the automated
browser can grant neither File System Access permission nor an OAuth flow, as
the survey's Budget predicted. Against that contract all three writable
implementations do honour CAS: `fs.ts`'s `checkCas` treats `undefined` as
"must be absent" and is migration-aware for pre-hash `mtime:size` tokens;
`githubBackend.write` passes `expectedVersion` as the Contents-API `sha` and
deliberately does *not* fall back to its own `_shas` cache. `encodeBase64` is
UTF-8-safe. No CAS gap was found in any backend.

**Vaults used.** The 20 hand-written fixtures in `src/model/__tests__/fixtures/`,
plus ~55 synthetic single-file vaults written for the probes. The large-vault
generator (`storage/devFixtures/testVaultGen.ts`) was **not** used: nothing this
run found is volume-dependent, and the two candidates that would have been
(batch write, reconcile fan-out) fall in the skipped atomicity category.

**Quality gates** — one run each, on a fresh worktree with the gitignored types
generated first (`pnpm run build` for `src/routeTree.gen.ts`,
`pnpm --filter meridian-oauth-worker run cf-typegen` for the worker types):

| Gate | Result |
|---|---|
| `pnpm run build` | **pass** (exit 0) |
| `pnpm run lint` | **pass** (exit 0; depcruise: no violations, 445 modules / 1714 dependencies) |
| `pnpm test` | **pass** — 157 files / 3425 tests, plus worker 3 files / 41 tests |

**Fraction of the integrity-critical surface.** Roughly **70%**. Read end to
end: `fileIO.ts`, `nodeSchema.ts`, `inheritance.ts`, `storeItems.ts`,
`fieldRegistry.ts`, `collapse.ts`, `merge.ts`, `roundTripCheck.ts`,
`expansionCache.ts`, `dateUtils.ts`, `duration.ts`, `retention.ts`,
`storeCommit.ts`, `persistencePort.ts`, `occurrenceActions.ts`, `sync.ts`,
`cache/files.ts`, `cache/db.ts`, `cache/pendingMoves.ts`, `entityWrites.ts`,
`inFlight.ts`, `syncScheduler.ts`, `backend.ts`, `localBackend.ts`, `fs.ts`,
`githubApi.ts`, `exampleBackend.ts`, `conflictError.ts`, `conflictName.ts`,
`moveEntry.ts`, `retentionSweep.ts`, `parseReport.ts`, `useAutoSave.ts`,
`editor/save.ts`. Read partially: `storeOps.ts` (~40%), `expansion.ts` (~55%),
`githubBackend.ts` (write/delete/error paths only). Not read: `repeat.ts`,
`vaultRegistry.ts`, `githubOAuth.ts`, `storage/ical/*`, `syncJournal.ts`,
`syncState.ts`, `itemIndex.ts`.

**Unverified — flagged, not claimed:**

- **A torn multi-file operation.** `persistEntries` writes N files in a loop of
  independent, individually-transactional Dexie writes; `beginSwipeDelete`'s
  non-recurring branch then calls `deleteEntity` *after* that loop
  (`occurrenceActions.ts:183`). A crash between them leaves some files'
  `[[wikilink]]` backlinks stripped while the target still exists. Settling it
  needs a way to abort the process between two awaits — a fault-injection hook
  in `persistencePort`, or driving `persistEntries` directly with a
  `writeEntity` stub that throws on the second call.
- **Mock/real divergence in `sync.test.ts`.** `vi.mock('@/storage/cache/files')`
  (line 80) is still a hand-written re-implementation of the real cache. It is
  *close* — `recordLocalEdit`'s base capture, `markPushed`'s content
  precondition and `applyRemoteBatch`'s dirty skip all match — but one gap is
  visible by inspection: the fake's `applyRemoteBatch` drops `lastModified`,
  which the real one carries through via `...r`, so no sync test can catch a
  regression in the retention sweep's age signal. Settling whether anything
  *else* diverges needs a differential harness running one operation script
  against both implementations and diffing the resulting rows.
- **`repeat:` reaches `expandNode` through an unchecked cast**
  (`storeItems.ts`, `n.fields.repeat as Repeat`). A hand-written
  `repeat: weekly` (a bare string) round-trips intact — verified — but is read
  by `expandNode` as an `after_completion` rule with a default `1 day`
  interval, producing an occurrence set that has nothing to do with what the
  user wrote. No byte is lost, so it is below this survey's bar; noting it
  because the same cast is what makes finding #4's structural-key hole
  reachable from the other direction.

---

## 3. Category verdicts

| # | Category | Verdict |
|---|---|---|
| 1 | Round-trip fidelity & edit locality | **findings: #4** |
| 2 | Lost updates & conflict handling | **clean** |
| 3 | Cache coherence & durability | **findings: #7** |
| 4 | Atomicity & partial failure | **partially assessed** — read end to end (`pushDirty`, `applyRemoteBatch`, `markInFlight`/`clearInFlight`'s refcounting, `moveEntityInCache`'s stage-then-release, `settlePendingMoves`) and nothing wrong was found by inspection, but no interruption was actually injected. The one concrete suspicion is recorded as unverified above. |
| 5 | Destruction & recoverability | **findings: #4** (a hand-written `excluded:` marker in a shape the parser can't type is deleted on save, so a deliberately-hidden occurrence silently returns). Everything else in this category — swipe-delete undo, `deleteFollowing`, the staged cross-vault move, the retention sweep's undo — was probed and is **clean**. |
| 6 | Temporal correctness | **clean** |
| 7 | Input validation & untrusted files | **findings: #4** |

---

## 4. Findings

Ranked by `(impact × breadth) ÷ effort`, with `effort` read as the
recommended-model ordinal (Sonnet 5 = 2, Opus 5 = 3, Opus 5 plan-mode = 5).

| # / rank | Finding | Invariant | Failure mode | Impact | Breadth | Recommended model |
|---|---|---|---|---|---|---|
| **#4** | A malformed *structural* key has nowhere to live and is deleted on save | 1, 7 | **silent** | 7 | all 6 `STRUCTURAL_KEYS`, every node of every file; 6 of 14 probed shapes lose bytes | Opus 5 |
| **#7** | A pending editor autosave is never flushed at page teardown | 6 | **silent** | 4 | 1 file; every editor session | Sonnet 5 |

Numbers are identity **and** rank for this run — the two coincided, so there is
no separate rank column to read.

**Sequencing note.** #4 lands in the parse/emit pipeline. The guard over that
pipeline (formerly tracked as finding #5 — it compared parsed values rather
than source text and skipped `date`/`time`/`repeat`/`excluded` outright) is now
fixed, so `roundTripLoss` will surface it as soon as its own fix lands. #4's own
widening of `collectKeyValues`' `STRUCTURAL_KEYS` skip is already done as part
of the guard fix, so #4 only has the deletion itself left to fix. #7 is
independent of it.

---

### #4 — A malformed *structural* key has nowhere to live and is deleted on save

- **Invariant violated:** 1 (round-trip fidelity), and 7 (recoverability) for
  the `excluded:` case. Fires on **any save** of an affected file — an unedited
  collapse already drops the key, so any edit anywhere in the entry writes the
  loss to disk.
- **Category:** `round-trip` `validation` `recoverability`
- **Failure mode:** **Silent.** `roundTripLoss` reports `[]` for every case
  below, because `collectKeyValues` deliberately skips `STRUCTURAL_KEYS` — so
  the one warning path (`reportRoundTripLosses`, "This is a bug — please report
  it") is structurally unable to fire for any of them.
- **Impact:** **7** — silent deletion of the key that *defines* the entry's
  schedule, plus one case that resurrects a deliberately-hidden occurrence and
  one that actively injects garbage keys into the file. Below finding #1 only
  because the shapes are less likely to be typed by hand than `tags: shopping`.

**Repro.** Six starting files, verbatim (each is the frontmatter shown plus
`title: Note`, `project: apollo` and a `Body.`):

| Starting frontmatter | Observed after a save | Expected |
|---|---|---|
| `date:`<br>`  - 2026-04-08` | the whole `date:` block is **gone**; the entry silently becomes undated | the value survives, or the file is refused as unreadable |
| `date:`<br>`  start: 2026-04-08` | `date:` **gone** | as above |
| `date: 2026-04-08`<br>`time:`<br>`  - "09:00"` | `time:` **gone** | as above |
| `date: 2026-04-08`<br>`excluded: "yes"` | `excluded:` **gone** — the occurrence the user hid reappears | as above |
| `date: 2026-04-08`<br>`instances:`<br>`  a: 1` | the whole `instances:` block is **gone** | as above |
| `date: 2026-04-08`<br>`defaults: everything` | ten new keys appear: `"0": e`, `"1": v`, `"2": e`, `"3": r`, `"4": y`, `"5": t`, `"6": h`, `"7": i`, `"8": n`, `"9": g` | as above |

The last row is the sharpest: a scalar `defaults:` is spread character-by-character
into the root, so the save *adds* ten garbage keys to the user's file.

Failing test:

```ts
import { describe, it, expect } from 'vitest'
import { parseToStoreItems } from '@/model/storeItems'
import { serializeEntry } from '@/model/collapse'
import { roundTripLoss } from '@/model/roundTripCheck'

const CASES: Array<[string, string]> = [
  ['date as list',         'date:\n  - 2026-04-08'],
  ['date as mapping',      'date:\n  start: 2026-04-08'],
  ['time as list',         'date: 2026-04-08\ntime:\n  - "09:00"'],
  ['excluded as string',   'date: 2026-04-08\nexcluded: "yes"'],
  ['instances as mapping', 'date: 2026-04-08\ninstances:\n  a: 1'],
  ['defaults as scalar',   'date: 2026-04-08\ndefaults: everything'],
]

describe('malformed structural keys', () => {
  it.each(CASES)('%s survives an unedited save, or is reported', (_name, frag) => {
    const content = `---\ntitle: Note\n${frag}\nproject: apollo\n---\n\nBody.\n`
    const parsed = parseToStoreItems('note.md', content, 'v')
    const saved = serializeEntry(parsed.items, parsed.root)
    const key = frag.split('\n').pop()!.trim().split(':')[0]!

    // Either the key survives, or the guard says it was dropped. Today: neither.
    expect(saved.includes(key + ':') || roundTripLoss('note.md', content, parsed).length > 0).toBe(true)
  })
})
```

**Breadth.** All six `STRUCTURAL_KEYS` (`date`, `time`, `repeat`, `excluded`,
`instances`, `defaults`), on every node of every file. Search run: 14
malformed-structural shapes through parse → collapse → `roundTripLoss` →
`expandRange`. **6 of 14 lose bytes; 1 of 14 injects garbage; all 14 report a
clean round trip.** `repeat` in any shape happens to survive (it is stored and
re-emitted opaquely) — that is luck, not coverage: it survives because
`collapseToYaml` copies `s.repeat` through verbatim, not because anything
guards it.

**Evidence.** The hole is that `RESERVED_KEYS` excludes structural keys from the
`extra` bag while `malformedKnownFields` only ever considers `INLINE_FIELDS`, so
a wrong-shaped structural value has no home at either level.
`src/model/fieldRegistry.ts:56-65`:

```ts
/** Keys the YAML shape itself owns — never metadata, never part of `extra`. */
export const STRUCTURAL_KEYS: ReadonlySet<string> = new Set([
  'date', 'time', 'repeat', 'excluded', 'instances', 'defaults',
])

/** Structural keys plus every registry key, at both levels. */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  ...STRUCTURAL_KEYS,
  ...INLINE_FIELDS.map(s => s.key as string),
])
```

and the guard's matching blind spot, `src/model/roundTripCheck.ts:47`:

```ts
    if (STRUCTURAL_KEYS.has(k)) continue
```

The `defaults:` explosion comes from `src/model/storeItems.ts`'s `buildRoot`,
which spreads without checking the shape:

```ts
  const defaults = (rawNode.defaults as Record<string, unknown> | undefined) ?? {}
  return extractFileMetadata(
    { ...defaults, ...rawNode, body: body || undefined },
```

**Problem.** A structural key written in a shape the parser cannot type is
silently deleted from the user's file on the next save — taking the entry's
schedule, its override list, or a deliberate exclusion with it — and the
round-trip guard is explicitly coded not to look at those keys.

**Fix.** Decide where a wrong-shaped structural value goes and put it there —
either refuse the file (throw in `parseToStoreItems`, routing it to
`unreadableFiles` where it is loud, visible and untouchable) or carry it in a
structural remainder that `collapseToYaml` re-emits — and widen
`collectKeyValues` to stop skipping structural keys so the guard reports it
either way; afterwards the test above passes for all six cases.

**Task context**

- **Why this stays at Opus 5, and what the context can and cannot settle.**
  The mechanism is fully diagnosed and the sites are named below, but the choice
  between the two fixes is a product decision with real consequences either way:
  *refusing the file* means a single mistyped `date:` drops a whole entry out of
  the vault (loud, safe, and a visible regression for anyone whose file loads
  today), while *carrying a structural remainder* means `collapseToYaml` can emit
  a `date:` that disagrees with the item's own — the exact double-emission hazard
  `emitExtra`'s `STRUCTURAL_KEYS.has(k) continue` guard (`collapse.ts:176`) was
  added to prevent, so it needs a separate bag with its own emit rule rather than
  reuse of `extra`. Adding words does not make that call for the implementer.
  Worth noting that the survey's own scoring rule ("a malformed file that throws
  a visible parse error is a far better outcome than one that quietly drops a
  frontmatter key") points at refusal.
- **Sites to change, whichever way it goes.** The decision point is
  `src/model/storeItems.ts`'s `effectiveNodeToStoreItems` walk — each of the
  three `scalarToString(n.fields.date) ?? ''` / `?? 'undated'` coercions is a
  place where a non-scalar value is currently swallowed. `excluded` is read as
  `child.fields.excluded === true`, which silently treats every non-`true` value
  as "not excluded". `instances` is read as `Array.isArray(node.instances) ?
  node.instances : []` in `inheritance.ts`'s `buildEffectiveTree`. `defaults` is
  the `buildRoot` spread quoted above, and separately `childDefaults`'
  `node.defaults ?? {}` in `inheritance.ts`.
- **The guard half is done.** It shipped as part of finding #5's fix:
  `roundTripCheck.ts`'s skip now only special-cases `instances`/`defaults`
  (which legitimately restructure); `date`/`time`/`repeat`/`excluded` are
  compared by parsed value like any other registry field, so a save that
  drops one is no longer invisible to `roundTripLoss` — only unfixed. What is
  left for this finding is the deletion itself.
- **Precedent.** `malformedKnownFields` (`fieldRegistry.ts`) is exactly this
  problem already solved once, for inline fields — including the "the raw value
  wins over the typed fallback on emission" rule that `fileMetaToYaml` /
  `occMetaToYaml` implement. Read it before designing the structural equivalent;
  the asymmetry is deliberate today only in the sense that nobody has needed the
  other half yet.

---

### #7 — A pending editor autosave is never flushed at page teardown

- **Invariant violated:** 6 (durability of accepted writes). Fires when the tab
  is closed, the browser crashes, or the OS evicts a backgrounded PWA within the
  1500 ms after the last keystroke.
- **Category:** `durability`
- **Failure mode:** **Silent.** The editor showed the text; nothing said it was
  not saved; on reload it is not there.
- **Impact:** **4** — bounded to one debounce window of typing, and only the
  body, but it is content the UI presented as present and nothing anywhere holds
  a copy of it: it never reached the store, so it never reached Dexie.

**Repro.** Starting state: an entry open in the editor. Operation: type; within
1.5 s of the last keystroke, close the tab (or background the PWA on iOS and let
the OS reclaim it).

**Observed:** the typing since the last committed autosave is gone on reload.
**Expected:** it is committed, exactly as it is on `goBack` and on unmount.

Failing test (`src/editor/`, jsdom):

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRef } from 'react'
import { useAutoSave } from '@/editor/useAutoSave'
import type { EntryState } from '@/editor/state'

describe('autosave durability at teardown', () => {
  it('a pending autosave is committed when the page goes away', () => {
    vi.useFakeTimers()
    const commit = vi.fn()
    const { result } = renderHook(() => {
      const entryRef = useRef({ editScope: 'all', body: '' } as unknown as EntryState)
      return useAutoSave(commit, entryRef, '')
    })
    act(() => { result.current.scheduleAutoSave('the user just typed this') })
    expect(commit).not.toHaveBeenCalled()

    // The only two signals the app gets. React unmount effects do NOT run here.
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'))
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(commit).toHaveBeenCalled()   // ← fails today
    vi.useRealTimers()
  })
})
```

**Breadth.** One file to change; every editor session in the app is exposed.
Search run: `grep -rn "flushAutoSave\|cancelAutoSave" src/` — three call sites,
all of them in-app navigation (`useEntryEditor.ts:260` `goBack`,
`useEntryEditor.ts:173` → `useVaultTarget.ts:110` on a vault-target change, and
the unmount cleanup at `useAutoSave.ts:44`). None of them is a teardown signal.

**Evidence.** `src/editor/useAutoSave.ts:46-55` — a 1500 ms debounce with no
teardown escape:

```ts
  const scheduleAutoSave = (body: string) => {
    if (entryRef.current.editScope === 'add') return
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    bodyRef.current = body
    autosaveTimerRef.current = setTimeout(() => {
      commitEntry({ ...entryRef.current, body })
      autosaveTimerRef.current = null
    }, 1500)
  }
```

and `src/routes/__root.tsx:170-197`, where the two teardown signals *are* handled
— but only for the cache→backend leg, not the editor→store one:

```ts
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        flushPendingPush()
        return
      }
```

```ts
    window.addEventListener('pagehide', flushPendingPush)
```

`flushPendingPush` pushes what is already in Dexie. The pending autosave is not
in Dexie; it is in a `setTimeout`.

**Problem.** The editor's debounced body autosave has no teardown flush, so the
last 1.5 s of typing is lost when the tab closes or a backgrounded PWA is
evicted — while the two lifecycle events that would catch it are already being
listened for, one layer away.

**Fix.** Have `useAutoSave` register its own `pagehide` / `visibilitychange`
listener calling `flushAutoSave`, and ensure it runs before
`flushPendingPush`; afterwards the test above passes.

**Task context**

- **Sites to change.** `src/editor/useAutoSave.ts` — add an effect registering
  `pagehide` and `visibilitychange` (the latter guarded on
  `document.visibilityState !== 'visible'`, matching `__root.tsx:171`) that calls
  `flushAutoSaveRef.current()`. The latest-ref plumbing already exists at
  `useAutoSave.ts:41-43` and is there for exactly this reason; reuse it rather
  than capturing `flushAutoSave` in the listener's closure.
- **The ordering trap, located.** `flushAutoSave` → `commitEntry` →
  `commitNext` → `persistEntries` → `writeEntity`, and `writeEntityToCache`
  (`entityWrites.ts`) reaches its first `await` before `recordLocalEdit` starts.
  During `pagehide` there is no guarantee a later microtask runs, so the editor
  flush must be registered such that it runs **before** `__root.tsx`'s
  `flushPendingPush` — otherwise the push scans a cache that does not yet have
  the row. Listener order for the same event on the same target is registration
  order, and `__root.tsx`'s effect runs at app mount, i.e. *first*. Registering
  from the editor hook therefore puts it second. Two workable answers: register
  the editor's flush on `__root`'s own handler via a ref (the pattern
  `flushEditsRef` at `useEntryEditor.ts:91` already establishes), or accept that
  the next launch's `syncOnActivate` → `pushDirty` rescues the row — which it
  does, since the Dexie write is what matters and the push is best-effort by
  design (`__root.tsx:173-177` says so). Prefer the ref: it makes the ordering
  explicit instead of relying on the rescue.
- **What stays.** Do not touch `cancelAutoSave` (`useAutoSave.ts:31-34`) or its
  call site in `handleDelete` (`useEntryEditor.ts:280`) — it deliberately drops a
  pending save so `goBack`'s flush cannot resurrect an item that is about to be
  deleted. A teardown listener added without checking that `cancelAutoSave` has
  already cleared the timer would reintroduce exactly that resurrection.
- **The `add`-scope guard.** `scheduleAutoSave` returns early for
  `editScope === 'add'` (`useAutoSave.ts:47`), so a brand-new draft never has a
  pending timer and the new listener is a no-op there. That is correct and
  should stay — a teardown flush that created a file from an abandoned draft
  would be a new bug.
- **Why Sonnet 5.** One file, one effect, the latest-ref pattern already
  present, a jsdom repro that fails before and passes after, and the one real
  hazard (listener ordering against `flushPendingPush`) named with both
  acceptable resolutions.

---

## Note on the survey file

`plans/surveys/data-integrity.md` was updated in a separate commit on this run:
the five "Known suspects" verdicts were re-issued against current `main` (two
are now settled and one is newly confirmed with a repro), and a handful of
process improvements this run surfaced were proposed as ordinary diffs on that
file — chiefly that the survey should require probing the **edited** round trip
explicitly, not just the unedited one, since that is where most of this run's
fidelity findings live and where the repo's own guard does not look.
