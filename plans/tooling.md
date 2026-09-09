# Tooling: wiring generators to the properties we already wrote

Came out of a read of the full iterations dataset (`blog/2-how-meridian-was-built/`,
985 merged PRs) looking for the tools that would have removed the most work.
Written 2026-09-09.

**Status:** the four steps are issues, not sections in this file — see
[`plan:tooling`](https://github.com/realJohnDoe/meridian/labels/plan%3Atooling).
This file keeps only the reasoning behind them, which no issue is the right home
for: why these four and not the two that were cut.

| | Step | Tier |
|---|---|---|
| #1003 | Generate the round-trip corpus with fast-check | Sonnet 5 |
| #1004 | Fail the build when a route is filed under the wrong shell | Sonnet 5 |
| #1005 | Contrast sweep across all nine themes | Sonnet 5 |
| #1006 | Spike: can the storage layer be driven deterministically? | Opus 5 |

---

## The finding this rests on

The candidate list started at five tools and lost two to inspection. What
survived has one shape in common, and it is **not** "we lack a checker":

> In every case the property was already written, or trivially writable, and
> what was missing was something to **generate inputs for it**. Nobody had to
> anticipate the failure — only the invariant.

The evidence, from the dataset:

- **One property, seven defects.** `roundTripLoss()` states the round-trip
  invariant exactly, `round-trip-totality.test.ts` runs two forms of it, and
  `yaml-roundtrip.test.ts` already sweeps both over a corpus. The corpus is
  **20 hand-written files**, and every one of the seven round-trip defects
  (#628, #629, #630, #664, #975, #976, #979) was a file shape nobody had put
  in that directory.
- **Six invariants, thirty defects.** All 30 sync bugfixes violate one of six
  sentences. One of them — *no acknowledged write is lost* — was broken **16
  times between 11 June and 6 September**. #221 and #516 are the same
  eventual-consistency eviction, found twice, two months apart.
- **Ten invariants, sixty defects.** Of the 109 visual-surface bugfixes, 60
  fall out of ten general predicates. Contrast alone accounts for 11 of them
  and this app has nine themes.

The corollary, which is why #1006 is a spike rather than a build: a tool that
**finds** needs a generator *and* a general property. A tool that only enforces
has neither, and is a regression test with extra steps.

---

## Not doing, and why

Recorded so they aren't re-proposed.

**A universal ratchet** (one baseline format across eslint / knip /
dependency-cruiser / coverage, with a `--tighten`). The idea is sound — every
gate in this repo was adopted retroactively, and each arrived with a backlog to
clear first. But the repo already has a per-tool ratchet for each gate that
matters (`--max-warnings`, vitest thresholds, `.dependency-cruiser.mjs`), the
prior art is `betterer` and it is effectively unmaintained, and building a
generic one is a side project rather than maintenance. The cost of adopting the
*next* rule is now one config edit, not a project. Not worth it.

**A findings ledger for survey runs.** 47 merged PRs were survey bookkeeping —
renumbering findings, moving results files, `plans/CLAUDE.md` existing partly to
govern the paperwork. Real overhead, but not a tooling gap: an issue tracker
with one label covers nearly all of it, and covers parts of it *better* — an
issue number is a permanent id, `Fixes #N` closes a finding when its PR merges,
and a deferral stays visible instead of being deleted. **That is now the
convention** (`plans/CLAUDE.md`, "Findings and plan steps are issues"), and this
plan is the first thing filed under it.
