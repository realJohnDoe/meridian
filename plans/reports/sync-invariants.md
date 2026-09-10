# The six sync invariants, and where they came from

_Derivation report for #1021, written 2026-09-10. The follow-up #1006's spike
report recommended, now with the six sentences actually enumerated. The
assertions themselves live in `src/storage/__tests__/syncInvariants.ts`; this
records how the list was arrived at, so a seventh sentence — or a correction to
one of these — can be argued against the same evidence._

## Why this had to be derived rather than looked up

The tooling analysis that started this line of work reported:

> Six invariants, thirty defects. All 30 sync bugfixes violate one of six
> sentences. One of them — no acknowledged write is lost — was broken 16 times
> between 11 June and 6 September.

Only that one sentence survived into writing. The other five were counted and
never written down, so #1021 made deriving them part of the work — the same way
#1003's round-trip axes were re-read out of its seven defects rather than taken
as given.

The material: every merged sync/cache/conflict/reconcile fix in the tracker,
read for *what claim it restored* rather than what code it touched. The
repository's history is squashed, so the PR bodies are the record.

## The six

| # | Sentence | Kind | Checked |
|---|---|---|---|
| 1 | **No acknowledged write is lost.** Content the app said was saved stays reachable until a client that had *seen* it acts to replace or delete it. | safety | after every step |
| 2 | **A record marked clean is one the remote agrees with.** Its version is a version the remote really held, at exactly this content. | safety | after every step |
| 3 | **A conflict copy means two clients genuinely diverged.** | safety | after every step |
| 4 | **The store and the cache name the same entries.** What the user is looking at is what a reload would give them. | safety | after every step |
| 5 | **No local change is stranded.** Once the world settles, nothing is still dirty. | liveness | when settled |
| 6 | **Settled clients agree.** Two devices with nothing left to push hold the same content for every path. | liveness | when settled |

The safety/liveness split is not a taxonomy for its own sake — it decides *when*
each can be asserted. 1–4 must hold at every instant, so a generated run checks
them after every operation. 5 and 6 are claims about where the system ends up,
and asserting them mid-flight would fail on a second device that has simply not
run a cycle yet. They are checked whenever the world is quiet, and every
generated run ends with a settling phase so they are checked at least once.

## The derivation, defect by defect

### 1. No acknowledged write is lost

The one the analysis named, and the one that pays: sixteen defects, and both of
the spike's own findings are instances of it.

| Defect | What was lost |
|---|---|
| #114 | A backend edit and a local edit collided and one was overwritten — the fix is the conflict copy that keeps both. |
| #119 | `reconcileWithDisk` deleted dirty cache entries, dropping edits that had never been pushed. |
| #386 | A tombstone whose base version had diverged retried with a fresh SHA and deleted a remote edit, with no conflict copy. |
| #481 | Three ways for a dirty record to sit unpushed indefinitely (also invariant 5 — see below). |
| #516 | A just-pushed file read as a remote delete and evicted from the store. |
| #520 | A post-push unconditional clean write discarded an edit that landed during the round trip. |
| #529 | The same on the pull side, across a whole batch. |
| #827 | A version-less delete CASed against a stale SHA cache, destroying a remote edit. |
| #977 | A second view of one vault inherited the shared row's version and destroyed the first view's work with no conflict at all. |
| #981 | A debounced autosave never reached Dexie before the tab closed. |
| #1017 | The #827 fix inverted: a delete with no base version now destroys whatever sits at the path, including a file this device never held. **Still open.** |

**Making it checkable** was the hard part, and it is not "is the content still
there". A delete is *supposed* to remove content. What separates a legitimate
delete from #1017 is whether the client doing the removing had ever observed
what it removed — which is the rule `resolveCollision` already states for itself
(`sync.ts`: *"an edit beats a delete"*), read from the other side. So the oracle
tracks, per client and per path, which content that client has held, and retires
an owed write only when a client that had observed it supersedes it.

Two refinements were forced by false positives during the build, and both are
worth recording because each one looked right first:

- **Content is matched by a token, not by bytes.** `resolveCollision`'s merge
  branch combines two sides into a file equal to neither. A byte-equality oracle
  reports a successful three-way merge — the one outcome where nothing at all
  was lost — as a loss.
- **A write is owed per *field*, not per file.** Two clients can each supersede a
  different half of the same earlier write (one retitles, the other rewrites the
  body); the merged result then contains neither of the original's tokens while
  having lost nothing. Owing per file reports that as a loss. Forgiving anything
  the new content carried forward fixes that but opens a real hole — a title edit
  would retire the body token it left untouched, and a later write that dropped
  that body would go unnoticed. Per field has neither problem.

### 2. A record marked clean is one the remote agrees with

Three defects are the same mistake at three sites: the cache recording an
agreement with the backend that did not exist.

- **#520** — `pushDirty` captured a record's content *before* the network round
  trip and wrote it back clean unconditionally afterwards. An edit landing during
  the round trip was clean-stamped away. The fix (`markPushed`) makes the clean
  write conditional on the cached content still being what was pushed.
- **#529** — the same on the pull side: `cacheBulkWriteClean` did an
  unconditional `bulkPut` after a network read, clean-stamping over any local
  edit that landed since the snapshot.
- **#738**, part 1 — a push recorded `backend.write()`'s return value verbatim,
  and the contract returns a token only *"if the backend can determine it"*. A
  recorded `undefined` makes the next push a create, which every backend refuses
  for a file that exists: a conflict, and a conflict copy, manufactured by us.

What makes this checkable is that a blob SHA is content-addressed and immortal,
so the simulated remote can be asked a question a live one cannot answer after
the fact: *did you ever hold this content at this version?* A clean row that
fails it is a lost update waiting for its next CAS to pass.

### 3. A conflict copy means two clients genuinely diverged

A duplicate file the user has to reconcile by hand is a real cost, and it must
be paid only for a real conflict.

- **#738**, part 2 — `resolveCollision` went straight from `ConflictError` to
  writing a copy without asking whether anything had diverged. GitHub answers 409
  both for a genuine SHA mismatch and when it cannot fast-forward the branch ref
  behind a commit pushed moments earlier, so a single device with no second
  writer produced conflict copies byte-identical to the original.
- **#127, #129** — earlier forms of the same thing: every edit treated as a
  backend conflict, before CAS writes replaced 409-recovery.
- **#953** — an empty repo's `409 Git Repository is empty.` mapped to "conflict",
  greeting a first-time user with a conflict on a vault that had never synced.

Checked two ways: a copy is never byte-identical to the file at its base path
(#738 exactly), and the tokens in a copy and in its base must not all come from
one writer. Each copy is judged **once, at the step it appears** — a copy is
legitimate relative to what sat at its base path when it was written, and
re-judging it later against a base that has since been deleted calls a real
conflict manufactured. That correction was itself found by the generator.

### 4. The store and the cache name the same entries

The user's evidence that a save worked is the screen. A store that disagrees
with the cache is either showing something a reload will lose, or hiding
something the reload will bring back.

- **#119** — dirty cache entries evicted by reconcile.
- **#486** — a write-conflict copy existed in the cache but did not reach the
  store for ~60s or until a restart.
- **#570** — the vault painted from cache before syncing, which only works if the
  two agree.
- **#977** — the whole point: two views of one vault, one IndexedDB, two stores,
  and nothing announcing a change between them.

The harness drives `writeEntityToCache` directly — that is the spike's central
finding, and what lets a scenario state an edit as an edit — while the store
update for a *local* write happens one layer up in `storeCommit`. So a
locally-written path is legitimately absent from its own client's store here.
The assertion exempts exactly those, and spends the exemption the moment the
storage layer is seen putting the path in the store: from then on the path is
held to both directions, which is #516's failure exactly.

### 5. No local change is stranded

- **#481** — three separate ways to strand a dirty record: a debounced push that
  early-returned with no reschedule when a sync was already running, an
  activation that reconciled but never pushed what a previous session left dirty,
  and a tab going hidden with no flush.
- **#122** — the auto-sync that exists so a write does not wait for a manual one.
- **#820** — every push deferring the next pull by a full interval.

### 6. Settled clients agree

- **#168** — backend files missing from the local cache were never pulled.
- **#221** — an eventually-consistent listing read as ground truth in the same
  cycle as the push, re-pulling old content over a just-pushed file and dropping
  a just-created one.
- **#516** — the same silence read as a remote delete.
- **#92** — cache-first hydration with incremental reconcile, which is the
  mechanism the other three are bugs in.

This one has a precondition that has to be honoured or the assertion is wrong
rather than the code: `RECONCILE_DELETE_GRACE_MS` deliberately makes reconcile
ignore a listing's silence about a recently-written file for five minutes,
precisely because of #221 and #516. A remote delete therefore *cannot* reach the
other device before then. The settling phase jumps virtual time past the window
before asking whether the two clients agree; the constant is imported from
`sync.ts` rather than copied, so it cannot drift from the one that decides the
behaviour.

## What did not make the six

Recorded so the boundary is a decision rather than an oversight.

- **A cross-vault move leaves the entry in exactly one remote — never both,
  never neither** (#831). This is a genuine seventh invariant and it is *not*
  covered here: it is a statement about two vaults with two remotes, and this
  harness is two clients over *one* vault. Adding it means a second `FakeGitHub`
  and a second remote in the harness. Worth doing; out of scope for #1021.
- **Errors are classified correctly** (#229, #366, #408, #953's other half).
  Real defects, but they are about what the user is *told*, not about what is
  durable. Invariant 3 covers the one case where a misclassification destroys
  data (a manufactured conflict).
- **A conflict is diagnosable after the fact** (#738's journal, #833). A
  property about debuggability, not about correctness.

## What the assertions found

Running the generator against current `main`:

- **#1017 reproduces from a four-operation sequence** — shrunk by the generator,
  not written by hand — and the sequence is **wider than the issue's own
  reproduction**. #1017 reaches the version-less tombstone through a page
  *reload* (a cold `_shas`). No reload is needed:

  ```
  write('deviceB', 'note', 'title')            # B creates note.md and pushes it
  write('deviceA', 'note', 'title', 'draft')   # A creates its own; the page closes inside the 1s debounce
  del('deviceA', 'note')                       # A deletes its own draft — tombstone with no base version
  sync('deviceA')                              # the re-read supplies B's SHA, the CAS passes, B's file is gone
  ```

  A page that closes inside the autosave debounce leaves the same row — dirty,
  no base version — as a reload does. The defect is reachable from an ordinary
  close, which is a good deal more common than the interleaving #1017 describes.

- **No other violation of the six** in the sweeps run while building this: the
  pinned CI sweep (40 interleavings of up to 8 operations), and completed soaks
  of 400 and 1,200 generated interleavings of up to 14 operations each.
  Everything else the soaks surfaced was a fault in the oracle rather than in
  the sync engine — the merge false positive and the per-field retirement rule
  under invariant 1, and the re-judged conflict copy under invariant 3 — each
  fixed and recorded above. That is a statement about this operation alphabet — two
  devices, one vault, two slugs, writes/deletes/syncs/reloads, with a page close
  inside the debounce as a staging option — and not a clean bill of health for
  the sync engine. What it does not reach is listed under "What did not make the
  six" above, plus everything below the seam the harness drives: the two
  scenarios in `twoClient.test.ts` that call `backend.delete` directly are there
  because a sync cycle cannot express them.

One limit on how far a single soak can be pushed, found while measuring the
above and filed as **#1023**: the harness leaks across runs, so cost per run
climbs with how many have already run in the same process — 400 runs take ~75s,
1,200 take ~20 minutes, and 4,000 do not finish in half an hour. It is not
fast-check: a *fixed* four-operation sequence repeated 1,200 times shows the
same curve, with the timer count flat and the heap climbing. The journal ring,
`localStorage` and the Dexie tables were each measured across those runs and are
each flat, so none of them is it. Until #1023 is closed, several soaks of ~400
runs cover more ground per minute than one long one — and fast-check picks a
fresh seed each time, so the coverage is at least as good.

Because #1017 is open, a generated run that hits it stops there and the rest of
its sequence goes unexplored. Closing #1017 deepens every run in the file — the
entry in `KNOWN_VIOLATIONS` and the test pinning it are both to be deleted then,
and the pin is what makes sure they are.
