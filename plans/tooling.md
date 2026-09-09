# Tooling: wiring generators to the properties we already wrote

Came out of a read of the full iterations dataset (`blog/2-how-meridian-was-built/`,
985 merged PRs) looking for the tools that would have removed the most work.
Written 2026-09-09.

**Status:** nothing here has started. Four items. Three are small and specific;
the fourth is a one-day spike with an explicit kill criterion.

Per `plans/CLAUDE.md`: delete each PR's section from this file in the PR that
implements it, and delete the file when the last one goes.

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

**A findings ledger for survey runs.** 47 merged PRs are survey bookkeeping —
renumbering findings, moving results files, `plans/CLAUDE.md` existing purely to
govern the paperwork. Real overhead. But it is not a tooling gap: an issue
tracker with one `survey-result` label covers nearly all of it, and covers parts
of it *better* — an issue number is a permanent id (the citation convention in
`plans/CLAUDE.md` exists because every run renumbers from #1), `Fixes #N` closes
a finding when its PR merges, and a deferral stays visible instead of being
deleted. **This repository has never opened a single issue across 1000+ PRs.**
Whether to start is a workflow decision, not a tooling one, so it is out of this
plan — but it is the cheapest available win if the bookkeeping is annoying.

---

## PR 1 — Generate the round-trip corpus

**Model tier: Sonnet 5.** The property, the assertions and the sweep all exist;
this adds a generator and one dependency.

The two assertions live in `src/model/__tests__/round-trip-totality.test.ts` as
module-private functions — `assertCollapseTotality(slug, source)` (line 46) and
`assertSourceFidelity(slug, source)` (line 61). **Move them into
`__tests__/helpers.ts` first**, so the fixture sweep and the generated sweep run
the identical assertion rather than two copies that can drift. That extraction
is the whole architectural part of this PR.

Then add `fast-check` as a dev dependency and a new
`src/model/__tests__/round-trip-generated.test.ts` that runs both assertions
over generated file text.

**Decided: generate a structured record and `.map()` it to file text. Never
generate a raw string.** This is the trap that makes naive property testing of a
file format useless: fast-check shrinks a string by deleting characters, so the
counterexample it hands back stops parsing and then fails for a *different*
reason than the original. Shrinking a record and re-rendering the file at each
step keeps every intermediate valid, and the minimal counterexample renders
straight back into a `.md` you can drop in `fixtures/`.

The record should cover the axes the seven defects lived on — read
`model/fieldRegistry.ts` for the real vocabulary, but at minimum:

| Axis | Why it is in the generator |
|---|---|
| `crlf: boolean`, `trailingNewline: boolean` | `FileConvention`, `fileIO.ts:231`. This is #629 exactly. |
| keys the registry does not know | #628, #975 — frontmatter with no `StoreItem` home. |
| a key present with an empty value | #630 — "cleared" must be distinguishable from absent. |
| malformed scalars and arrays | #664 — these must land in the parse quarantine, not coerce. |
| values whose text ≠ their parsed form (`0700`, `1.50`, quoted) | #979 — saved as the characters written. |
| each `KeyRole` — `plain`/`leaf`/`opaque`/`node`/`nodeList` (`fileIO.ts:103`) | `opaque` is compared byte-for-byte; the others are not. |
| a body with an indented first line, interior blank lines, no body at all | `stripStructuralPadding` over-reached here once already. |
| `defaults:` + `instances:` overrides | the shape `fixtures/unknown-keys-series.md` has. |

**Trap: `assertSourceFidelity` is only valid on an UNEDITED round trip** — its
own doc comment says so. Generate, parse, serialize, compare. Do not apply an
edit in this test; finding #2 (clearing a field inherited from `defaults:`) is
explicitly outside what an unedited check can express and has its own regression
test.

**CI vs exploration.** The gated test pins `seed` and a modest `numRuns`, so a
red build always reproduces. Roaming for new failures is a local/nightly thing —
raise `numRuns` and drop the seed. A counterexample gets **copied into
`fixtures/`** as a permanent regression case, which is the corpus mechanism that
already exists; that is the ratchet, the same way `it.fails` is in
`round-trip-totality.test.ts`.

Expect this to either find something in current `main` or demonstrate the corpus
is better than it looks. Both outcomes are worth the hour.

---

## PR 2 — Fail the build when a route is filed under the wrong shell

**Model tier: Sonnet 5.** One assertion in a script that already boots the app
and walks every route.

`CLAUDE.md`'s "Route shells" section names this hole precisely: *"a new route
can't silently go unlisted; it can still silently go in the wrong list."*
`assertRouteCoverage()` in `scripts/layout-smoke.mjs` catches the first half.
Nothing catches the second, and it has been got wrong **twice** — the entry
routes (fixed in `3de767a`, after keyboard avoidance had been hand-rolled across
six surfaces) and `/settings` (PR #840, fixed in #844).

The rule to encode: **a route whose own content contains a text-entry field
belongs on the document-flow chain, not under `_app`.** Concretely — for each
route the smoke script already visits, query for `input` (excluding
button/checkbox/radio/submit types), `textarea` and `[contenteditable]`; if any
are found and the route is in `APP_ROUTES`, fail naming the route and the field.

**Trap: scope the query to the route's own content, not the shell.** The `_app`
shell renders the search bar (`routes/-searchBar.tsx`), so a naive
document-wide query flags every app route immediately. #844 already had to
solve this for the growth probe — reuse the same anchoring, inside
`[data-flow-screen]` / the per-view content host rather than at `document`.

This needs no keyboard emulation and no new dependency, which is why it is here
and a general "focused input stays inside the visual viewport" assertion is not:
that one needs `visualViewport` emulation that headless Chromium does not
straightforwardly expose, and the structural rule catches the same two failures
that actually happened.

---

## PR 3 — Contrast sweep across all nine themes

**Model tier: Sonnet 5**, with the compositing step called out below as the one
part worth reading carefully.

Eleven merged PRs fixed contrast (#302, #329, #331, #340, #445, #478, #801,
#912, #924, #930, #954), and #924 was *"low-contrast text tiers across every
theme"* — the combinatorial case. There are nine selectable themes with a class
(`src/settings/themes.ts`, `THEMES`), mapped to `<html>` by `THEME_CLASS` in
`routes/__root.tsx:26`. **Iterate `THEME_IDS`** (`__root.tsx:46`) rather than
`THEMES` — it is already the canonical list with next-themes' `light`/`dark`
resolution ids filtered out, and `__root.test.tsx` asserts the two lists agree.

**Why not just axe-core.** axe resolves a background by walking up for an opaque
ancestor. `src/index.css` has **44 `color-mix()` uses**, and the chips are
deliberately low-opacity tints — #912, #917 and #927 are three consecutive PRs
tuning tint opacity. For those, axe reports *incomplete* rather than *violation*,
and in CI "needs review" is indistinguishable from silence. Sample the rendered
pixel instead and the whole problem disappears. **Verify this claim against axe's
own output before writing the sampler** — if axe does resolve these, use axe and
this PR shrinks to a loop over themes.

Shape: reuse the preview server `scripts/layout-smoke.mjs` already starts. For
each theme × each route, set the theme (`next-themes` with `attribute="class"`,
so writing `localStorage.theme` before load is the deterministic way in),
screenshot, then for each text-bearing element take its rect and computed
`color`, sample the composited background pixels from the screenshot under that
rect, and compute the ratio.

**Land it report-only first, then set the floor at what passes.** That is the
ratchet discipline this repo already uses — #663 ratcheted lint warnings before
#756 drove them to zero. A sweep that fails the build on day one against an
unknown number of pre-existing violations is a sweep that gets disabled.

Note the app has deliberate per-swatch ink decisions (#445 picks the
best-contrast ink per swatch per theme), so the check must read the *rendered*
result rather than assume a single foreground token.

---

## PR 4 — Spike: can the storage layer be driven deterministically?

**Model tier: Opus 5.** Open-ended, and the question is whether the seam holds.

This is the highest-value area by defect count and the least certain to be
cheap, so it is scoped as a spike, not a build.

Sixteen of the 30 sync bugfixes violate one sentence — *no acknowledged write is
lost* — and they kept arriving: #977 and #981 are both from September. Every one
is an interleaving, not a wrong function, and single-client tests cannot express
them. `src/persistencePort.ts` looks like exactly the seam a deterministic
harness would need (`writeEntity` / `deleteEntity` / `moveEntity`, with content
passed rather than looked up — its doc comment explains why that mattered).

**The spike, in one day:** stand up two simulated clients over one vault against
the real storage layer, with a fake clock and an owned scheduler, and
**reproduce one already-fixed bug from a seed** — #827 (a delete comparing a
tombstone against a stale SHA cache) is the suggested target because its
mechanism is well documented in its own PR.

**Kill criterion: if that reproduction is not working within a day, stop and
write down what blocked it.** The likely blocker is that the seam is cleaner in
`persistencePort` than in what sits behind it, and finding that out is worth the
day on its own. Do not let this become an open-ended build.

If it does work, the follow-up is the six invariants as assertions and a seed
corpus in CI with a roaming soak outside it — same split as PR 1. That follow-up
is **not** planned here; plan it after the spike reports.

**Prior expectation, recorded so the spike can falsify it:** this probably
reduces to `@sinonjs/fake-timers` plus a hand-written scheduler plus the six
invariants — a few hundred lines, not a new tool. Every other item on the
original list dissolved that way on inspection.
