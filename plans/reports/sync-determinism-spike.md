# Can the storage layer be driven deterministically?

_Spike report for #1006, run 2026-09-09. One day, as specified. The kill
criterion was "if the reproduction is not working within a day, stop and write
down what blocked it"; it worked, so this records what held, what did not, and
the one thing the reproduction found that nobody was looking for._

## Verdict

**Yes, and it cost less than expected.** Two simulated clients over one vault,
against the real storage layer, with a fake clock and an owned scheduler:
`src/storage/__tests__/twoClientHarness.ts` (417 lines) and
`twoClient.test.ts` (307 lines, 8 scenarios, 174 ms). No production code was
changed and no dependency was added.

The prior expectation the issue recorded so the spike could falsify it —
*"this probably reduces to `@sinonjs/fake-timers` plus a hand-written scheduler
plus the six invariants — a few hundred lines, not a new tool"* — survives, with
one correction in its favour: `@sinonjs/fake-timers` did not need adding.
Vitest's `vi.useFakeTimers()` **is** that library, already present.

## What is real, and what is simulated

Real: `GitHubBackend` (including the private `_shas` cache #827 was about),
`sync.ts`'s `pushDirty` / `resolveCollision` / `reconcileWithBackend`,
`syncScheduler.ts`'s debounce, `cache/files.ts` over genuine Dexie on
`fake-indexeddb`, and the Zustand store.

Simulated: the GitHub REST API (`FakeGitHub`, with CAS on `PUT`/`DELETE` and an
eventually-consistent tree listing), and the clock.

Stubbed, none of it the code under test: `notifications` (sonner wants a toast
host), `githubOAuth` (a token refresh is a network call), `fetch`.

For contrast, this is what the existing suites could not do. `sync-collision.test.ts`
says so in its own header — *"Lightweight CAS harness (mirrors pushDirty logic)"* —
it reimplements the policy it checks. `sync.test.ts` replaces `cache/files`,
`storeBridge` and `notifications` with in-memory fakes. Both are single-client
by construction.

## The seam held, and `persistencePort` was the right place to look

The issue guessed that `persistencePort.ts` "looks like exactly the seam a
deterministic harness would need", and warned that "the likely blocker is that
the seam is cleaner in `persistencePort` than in what sits behind it".

It is not. Two findings, and the second is the load-bearing one:

1. **Content-carrying writes are what make the harness cheap.** `writeEntity(key,
   content)` means a scenario states an edit as an edit. Had the adapter still
   resolved content out of the live store, every step would first have had to
   stage store state precisely enough for the adapter to agree with it — which is
   the same coupling that lost writes in the first place, reappearing as test
   setup.

2. **Two clients in one process needed no re-entrancy work at all.** Every piece
   of storage-layer module state is keyed by *vault id* — the backend registry,
   `syncStateFor`, the Dexie rows (`${vaultId}::${path}`), the store's layers. So
   two clients are two vault ids pointed at one `FakeGitHub` repo, and each
   client's state separates on its own. Nothing had to be made injectable, and
   no module was refactored to be testable.

   The alternative — one vault id, two module graphs via `vi.resetModules()` —
   does not work, and `cache.test.ts`'s header already says why: `resetModules()`
   doesn't re-evaluate externalised node_modules, so both graphs keep whichever
   `dexie` loaded first.

## What actually blocked it — none of it the storage layer

Most of the day went here. Recorded because a follow-up will hit all three
again, and because two of the three fail as a *wrong answer* rather than an error.

### 1. Octokit's Bottleneck groups are process-global and outlive a fake clock

`@octokit/plugin-throttling` keeps its limiters in a module-level `var groups = {}`
and builds them exactly once per process (`if (groups.global == null)`), so every
`GitHubBackend` in the process shares one write limiter — `maxConcurrent: 1`,
`minTime: 1000`. That limiter remembers `_nextRequest = Date.now() + minTime`
against whatever clock was installed when it last ran.

Installing a fresh fake clock back at `T0` for the next test therefore leaves it
holding a deadline far in the future. The next request waits, and at Bottleneck's
2-minute job timeout it is dropped. `readFiles` swallows that as *"the file isn't
there"*, so a delete is **silently skipped** — a wrong answer with no error
anywhere.

The fix is to install the fake clock once per file and never rewind it.
Determinism is unaffected: a seed is a fixed sequence of operations and a fixed
step size, not a fixed absolute instant. This is the single most important thing
to carry into the follow-up.

### 2. The debounced push outlives the call that armed it

`scheduleAutoPush` arms a 1 s timer on every write, and the pump has to cross a
full second anyway for the limiter above. So the debounce fires *during* a later
step and starts a cycle nothing awaits; the next explicit sync then bounces off
`runSync`'s `if (syncing) return` and silently does nothing — which reads, at the
assertion, as a push that was never attempted.

Owning the scheduler therefore means two helpers, not one: `quiesce()` drains
every vault back to idle after each step, and `closeApp()` cancels an armed
debounce, which is what a scenario means by "A edited and did not sync".

### 3. The store needs a DOM

`store.ts` reads `localStorage` and `navigator.language` at module load, so the
file runs under jsdom rather than the suite's default node environment. One
docblock; noted only so the next person doesn't debug it.

## The #827 reproduction

Reconstructing the removed line in test code (`withLegacyDelete`) and running the
**identical seed** against both is what makes this a reproduction rather than an
assertion about code that is no longer there. The seed:

1. Device A creates `note.md` and the app closes before the debounced push fires.
   A's row is dirty with **no base version** — the precondition the `_shas`
   fallback needs.
2. Device B independently creates a note on the same slug and pushes it.
3. A reopens (cold `_shas`) and the user deletes the draft. `recordLocalDelete`
   carries the row's `version` forward, so the tombstone has none either.
4. A syncs.

| | pre-#827 | current `main` |
|---|---|---|
| `DELETE` sent | none — early return | one, status 200 |
| Tombstone | dropped by `pushDirty` as success | confirmed |
| B's file | **survives** | **destroyed** |

Both halves reproduce, from a seed, in 23 ms.

## What the reproduction found

Two things neither the finding nor the fix anticipated. They are one defect and
are filed together as **#1017**; this section is the evidence.

### Finding #3's stated mechanism does not hold

The finding #827 closed says the pre-fix `delete` "goes out with whatever SHA the
last tree listing happened to hold, which may predate another device's edit, **and
GitHub accepts it**".

It does not. `DELETE /repos/{o}/{r}/contents/{path}` is itself a compare-and-swap.
Driven directly against a stale `_shas` — B's edit landing after A's last listing —
the pre-fix code sends the stale sha and gets **409**, and B's edit survives. The
`delete-conflict` branch the finding believed was being bypassed is reached.

The real pre-fix hazard was the *other* branch the finding named in passing and
then treated as a hazard of the fix: with no sha anywhere, the old code returned
early and `pushDirty` read that as success. That is a lost delete, not a destroyed
edit — a real bug, correctly fixed, described wrongly.

### The fix inverted the outcome in the adjacent interleaving

Same stale-listing scenario, current `main`: the re-read supplies the *fresh* sha,
the CAS passes, and B's edit is destroyed. Same interleaving, opposite outcome to
pre-#827.

This is not confined to the stale case. In the four-step seed above, current
`main` destroys a file device A had never read, never held a version for, and
never acknowledged — on the strength of a delete that meant A's own unsynced
draft. That violates the rule `resolveCollision` states for itself:

> Both directions follow one rule — **an edit beats a delete** — which is the
> same rule `pushDirty`'s tombstone branch already applies from the other side.

A delete with no base version cannot tell "this file was mine and its version was
lost" from "this path is somebody else's file I have never seen". #827 chose to
resolve that ambiguity toward *delete*; the first reading is safe and the second
is a lost write. The re-read supplies a sha for both. Filed as #1017.

## Recommended follow-up

The one #1006 anticipated, now with the obstacles priced in:

- **The six invariants as assertions**, over this harness. "No acknowledged write
  is lost" is the one that pays — it is what both findings above are instances of,
  and neither is expressible single-client.
- **A seed corpus in CI, a roaming soak outside it** — the same split as #1003. A
  seed here is a scripted interleaving, so the generator to write is one over
  *interleavings*, not over file text.
- Carry §1–§2 above into the harness before adding scenarios. Both failure modes
  are silent, and a soak that hits either will report a green run that never ran.

The eight scenarios already in `twoClient.test.ts` are the starting corpus.
