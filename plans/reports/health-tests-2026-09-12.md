# Codebase Health Survey — test code — 2026-09-12

A run of [`plans/surveys/health.md`](../surveys/health.md) with its ten
categories re-pointed at the **test suite** rather than at `src/`: the tests,
their fixtures and doubles, the configs that run them, and the gates that
gate them. The three questions the run was asked to answer on top of the
standard rubric were duplication in test code, the same behaviour asserted at
more than one activation level, and whether the suite could run faster —
losing strictness only where the trade is worth it.

Findings are issues, labelled `survey:health-tests`. This file is the record
of what was measured; per `plans/CLAUDE.md` it is not deleted when they close.

Commit surveyed: `287c052`. Machine: 4 cores, 15 GB, Linux.

---

## 1. Health verdict

The test suite is in genuinely good shape and unusually self-aware — helper
modules re-export production code rather than copying it and say so in
comments, `coverageConfig.test.ts` and `glossary.test.ts` are meta-tests that
guard config rot, and the sync suite has a written derivation of the six
invariants it checks. The two weakest areas are **`src/storage/__tests__/`**,
which carries the one file whose subject is a copy of production policy rather
than production itself, and **`vitest.config.ts`**, whose per-file coverage
floors have drifted far enough below measured reality that 25 of 57 are no
longer guarding anything. The structural theme running through the findings is
**over-activation**: correct assertions made at a more expensive level than
they need — a pure round-trip asserted through a React render, a CAS policy
asserted against a hand-written stand-in, a rate limiter left real against a
stubbed network. That is a form of overengineering, and it is the majority of
both the wasted wall-clock time and the misleading coverage signal here; the
one clear *under*-engineering finding is the opposite shape, `makeOcc`'s
shallow override forcing 143 copies of the same six-field literal. Nothing
found is a correctness risk to users — the worst of it costs CI minutes and
buys false confidence in two specific places.

## 2. Coverage statement

### Examined closely

- **Test infrastructure**: `src/test-utils/index.ts`, `src/test-utils/setup.ts`,
  `src/model/__tests__/helpers.ts`, `src/storage/__tests__/twoClientHarness.ts`,
  `src/storage/__tests__/syncInvariants.ts`.
- **Configs and gates**: `vitest.config.ts`, `worker/vitest.config.ts`,
  `playwright.config.ts`, `eslint.config.js`, `knip.json`,
  `.dependency-cruiser.mjs`, all four tsconfigs that include test code,
  `package.json` scripts, `.github/workflows/{build,ci,deploy-worker}.yml`.
- **The 15 largest test files by line count** (the ranking the Budget asks to
  be stated), all read at least in part:
  `sync.test.ts` (2587), `vaultRegistry.test.ts` (1094), `edits.test.ts` (956),
  `linking.test.ts` (927), `agendaSections.test.ts` (889), `cache.test.ts` (869),
  `AgendaView.test.tsx` (793), `githubBackend.test.ts` (750),
  `repeatToRrule.test.ts` (695), `TimeWheels.test.tsx` (561),
  `__root.test.tsx` (528), `useEntryEditor.test.tsx` (512),
  `contrast-sweep.spec.ts` (461), `save.test.ts` (434),
  `layout-smoke.spec.ts` (421).
- **Both e2e specs in full**, plus the app's `index.html` (reached while
  diagnosing e2e timing).
- **Suspected-duplicate pairs, read side by side**: `round-trip-totality` vs
  `round-trip-generated`; `deterministic-ids` vs `deterministic-occ-ids`;
  `twoClient` vs `twoClientGenerated`; `agendaSections` vs `useAgendaSections`
  vs `AgendaView`; `repeatForm` vs `RepeatDialog`; `occState` vs
  `OccurrenceCard`; `monthGridCells` vs `MiniMonth`; the three `FakeBackend`
  classes. Only two of these turned out to be real duplication (#1043, #1038);
  the rest are deliberately distinct and several say so in their headers.

### Sampled

2–3 files from every test-bearing directory (`calendar/`, `components/`,
`editor/`, `hooks/`, `lib/`, `model/`, `onboarding/`, `routes/`, `search/`,
`settings/`, `storage/`, `worker/src/`), plus mechanical sweeps over all 182
test files for: `vi.mock` targets, jsdom opt-ins, skipped/focused tests,
fixture-builder redefinitions, agree-by-convention comments, and per-file
timings.

### Skipped

- **`src/debug/`** — no tests, and it is dev-only tooling excluded from the
  lint rules by design. Recorded, not investigated.
- **`src/model/__tests__/fixtures/`** and **`src/storage/ical/__fixtures__/`** —
  data, read only where a specific test pulled one in.
- **`src/components/ui/**`** — shadcn mirror, excluded from coverage by
  deliberate policy; not evaluated.

### Environment constraints hit

- **The e2e wall-clock figure is a sandbox artifact and must not be read as a
  repo problem.** All 126 e2e tests take a near-identical ~14.5s here. Probing
  showed browser launch is 235ms and every local request finishes within 95ms;
  the ~12.6s is `https://fonts.googleapis.com/css2?family=DM+Sans…`, loaded as
  a render-blocking stylesheet from `index.html:54`, stalling against this
  environment's egress proxy and then resetting (`net::ERR_CONNECTION_RESET` at
  12,498ms). On a runner with normal egress this cost does not exist. Noted
  rather than filed — see "Looked at and deliberately not filed" below for the
  one durable observation it did surface.
- Only the example (Tutorial) backend is reachable; local-FS and GitHub
  backends were read statically and through their unit tests.
- The large-vault generator was not needed for this run.

### Gate × workspace matrix

Every gate was run once from a clean tree at `287c052`, after
`pnpm install`, `pnpm run build` and `pnpm --filter meridian-oauth-worker run
cf-typegen` (the generated-types prerequisite `CLAUDE.md` documents).

| gate | command | `src/` | `worker/src/` | `e2e/` | result |
|---|---|---|---|---|---|
| build / typecheck | `pnpm run build` | ✅ `tsc -b` + `tsconfig.test.json` | ✅ fans out to worker `typecheck` | ✅ via `tsconfig.e2e.json` reference | **pass** |
| lint | `pnpm run lint` | ✅ | ✅ | ❌ **not covered** (#1046) | **pass** |
| lint:deps | `depcruise src` | ✅ 473 modules, 1836 deps | ❌ | ❌ | **pass** |
| test | `pnpm run test` | ✅ 3703 tests | ✅ 50 tests | ❌ separate script | **pass**¹ |
| coverage | `pnpm run test:coverage` | ✅ global + 57 per-file floors | ✅ global floors only | ❌ | **pass** (floors drifted — #1039) |
| dead code | `pnpm run knip` | ✅ | ✅ | ❌ | **pass** |
| audit | `pnpm audit` | ✅ | ✅ | n/a | **pass at CI's `high`; 2 moderate below it** (#1045) |
| e2e | `pnpm run test:e2e` | n/a | n/a | ✅ 126 tests | **pass** |

¹ `pnpm exec vitest run` failed 2 of 3703 on two of four runs — the known
`startCrossTabSync` flake, #1031.

The two gaps this matrix makes visible: **`e2e/` is linted by nothing**
(#1046), and **coverage is gated per-file in the root only** — `worker/`
has a `coverage` block but globals only, which is proportionate to its 3 files
and, unlike the root's, has *not* drifted (3.7–5.9 points of slack against
87/74/82/92).

### Fraction of the codebase

The suite is 34,194 lines of test code in `src/` across 175 files, plus 882
lines in `e2e/` and 3 files in `worker/src/` — against 39,623 non-test lines in
`src/`. This report is based on close reading of roughly 35–40% of the test
code, mechanical sweeps across 100% of it, and measurement of 100% of it.

### Unverified

- **Order-independence of the 85-file "pure" bucket in #1041.** It was green
  un-isolated in this run, but one green run is not proof; `--sequence.shuffle`
  was not run. The issue says so and makes it a precondition of landing.
- **Whether `sync.test.ts` truly covers `sync-collision.test.ts`'s
  stale-listing case** (#1038). Eight of the nine map onto a named test against
  real code; the ninth (`makeStale`) maps onto a describe that looks right but
  was not traced assertion-by-assertion. Flagged inside the issue as the one
  thing to check before deleting.
- **Whether the webfont dependency can shift the contrast ratchet.** The sweep
  passed all 126 with the font failing to load entirely, which is evidence
  against; not pursued further.

## 3. Category verdicts

Categories are `health.md`'s, read against test code.

1. **Architecture & separation (test-suite structure)** — findings: #1038, #1044
2. **Simplicity & overengineering** — findings: #1038, #1043
3. **Directory & file layout** — **clean.** The `__tests__/` vs co-located
   split tracks a real distinction (fixture-corpus suites vs unit tests),
   helper modules sit beside their consumers, and the `model/` helpers
   deliberately do *not* import `@/test-utils` — with a comment explaining that
   it would drag the Zustand store into a pure node suite.
4. **Security** — findings: #1045
5. **Testing & error handling** — findings: #1038, #1039, #1043, #1031
6. **Code health & DRY** — findings: #1040, #1042, #1044
7. **Toolchain & feedback loops** — findings: #1039, #1041, #1045, #1046
8. **Dependencies & library fit** — findings: #1045
9. **Styling & UX** — **partially assessed.** Not meaningfully applicable to
   test code; the adjacent question actually checked was whether the e2e
   contrast/layout specs are the right tool for what jsdom cannot see, and they
   are — both spec headers argue the case and the axe-core rejection in
   `contrast-sweep.spec.ts:35-48` was verified as reasoning, not asserted.
10. **Performance** — findings: #1037, #1041, #1043

## 4. Findings

| rank | # | title | category | impact | breadth | model |
|---|---|---|---|---|---|---|
| 1 | [#1040](https://github.com/realJohnDoe/meridian/issues/1040) | `makeOcc`'s shallow override forces 143 metadata restatements | `dry` `testing` | 5 | 22 files | Sonnet 5 |
| 2 | [#1044](https://github.com/realJohnDoe/meridian/issues/1044) | 20 hand-rolled router mocks in 4 divergent shapes | `dry` `testing` | 3 | 10 files | Sonnet 5 |
| 3 | [#1045](https://github.com/realJohnDoe/meridian/issues/1045) | vitest 4.1.10 advisories below CI's audit threshold | `security` `dependencies` | 4 | 2 workspaces | Haiku 4.5 |
| 4 | [#1042](https://github.com/realJohnDoe/meridian/issues/1042) | `TimeWheels.test.tsx` copies production constants + geometry | `testing` `dry` | 4 | 2 files | Haiku 4.5 |
| 5 | [#1037](https://github.com/realJohnDoe/meridian/issues/1037) | `githubBackend.test.ts` sleeps 26s in a real rate limiter | `performance` `testing` | 6 | 2 files | Sonnet 5 |
| 6 | [#1046](https://github.com/realJohnDoe/meridian/issues/1046) | `e2e/` is invisible to ESLint | `toolchain` | 3 | 3 files | Sonnet 5 |
| 7 | [#1043](https://github.com/realJohnDoe/meridian/issues/1043) | 8 `RepeatDialog` tests re-assert a pure round-trip via render | `testing` `performance` | 4 | 2 files | Sonnet 5 |
| 8 | [#1038](https://github.com/realJohnDoe/meridian/issues/1038) | `sync-collision.test.ts` tests a copy of `pushDirty` | `testing` `dead-code` | 6 | 1 file | Sonnet 5 |
| 9 | [#1039](https://github.com/realJohnDoe/meridian/issues/1039) | 25 of 57 coverage floors drifted ≥10 points | `testing` `toolchain` | 6 | 1 file, 29 floors | Sonnet 5 |
| 10 | [#1041](https://github.com/realJohnDoe/meridian/issues/1041) | 226s of aggregate import time re-isolating 85 mock-free files | `performance` `toolchain` | 5 | 1 file | Sonnet 5 |
| — | [#1031](https://github.com/realJohnDoe/meridian/issues/1031) | `startCrossTabSync` flake (re-derived; commented, not re-filed) | `testing` | 5 | 2 tests | Sonnet 5 |

**The ranking formula inverts the important order here, and the reader should
know it.** `(impact × breadth) ÷ effort` puts #1040 — a mechanical DRY cleanup
— five places above #1037 and eight above #1038 and #1039, purely because
"breadth" counts files and a 143-site find-and-replace touches 22 of them.
Anyone sorting by what actually matters should read **#1037, #1038 and #1039
first**: they are the three impact-6 findings, and they are the ones where
something is currently *wrong* rather than merely repetitive — a gate that
wastes a quarter of the suite's CPU, a test file that cannot fail, and 25
coverage floors that would not notice a regression.

**Sequencing.** #1045 before #1041 (both touch the vitest install). #1037
before #1041 (the measured 114s figure assumes #1037 has landed). #1038 before
#1039 (deleting a file changes what coverage measures). #1040 before #1044 —
both edit test files in `editor/` and `settings/`, and #1040's is the larger
diff.

**Not in the top 10 on effort grounds:** nothing. No architecture-category
finding was dropped by the divisor — category 1's two findings both made the
list. The list is 10 because 10 is what the evidence supported; per the shared
conventions it was not padded further.

## 5. The three questions, answered directly

### Duplication in test code

Real, but narrower than expected, and concentrated in **fixtures and mocks
rather than in tests**. The suite's assertions are not copy-pasted; its
*scaffolding* is. Three instances earned issues — the 143 metadata literals
(#1040), the four router-mock shapes (#1044), the copied `TimeWheels`
constants (#1042) — and a fourth resolves itself when #1038's file is deleted
(its 72-line `FakeBackend` is a strict subset of `sync.test.ts`'s 146-line one;
`moveEntry.test.ts`'s 19-line stub is genuinely different and should stay).

Several *apparent* duplications turned out to be deliberate and documented, and
are worth recording so the next run does not re-open them:
`round-trip-totality` vs `round-trip-generated` (hand-written regressions vs
generated corpus, both delegating to one shared assertion in `helpers.ts`);
`deterministic-ids` vs `deterministic-occ-ids` (parse-time vs expansion-time
identity); `TEST_VAULT` defined twice, with a comment explaining that importing
it would pull the store into a pure node suite.

### The same behaviour at different activation levels

Found in two places, and they are opposite cases.

**A genuine three-level stack on the sync CAS path**, where the bottom level is
the problem: `sync-collision.test.ts` (fakes everything *and* reimplements the
policy — tests nothing real, #1038), `sync.test.ts` (real `sync.ts`, faked
Dexie/store/toasts), `twoClient*.test.ts` + `syncInvariants.ts` (real
everything). Levels two and three are both justified and their headers say why.
Level one should go.

**A pure/render pair on the repeat form**, #1043: eight `RepeatDialog` tests
assert `formToRepeat(repeatToForm(r)) === r` by rendering the dialog, at 235ms
each, when `repeatForm.test.ts` asserts the same thing directly at 0.6ms — and
its `roundTrip` helper's own comment describes itself as "the open-and-Set
cycle", i.e. it already models the dialog.

Notably this is **not** a general pattern. A sweep for render-level tests with
no user interaction returned 22/24 in `OccurrenceCard.test.tsx` and 18/34 in
`__root.test.tsx`, but in those the rendered output *is* the subject.
`RepeatDialog` is distinctive because its no-interaction tests assert a
*callback payload* computed by a function with its own test file.

### Could the suite run faster

Yes — **158.1s → 114.2s (28%) with no loss of strictness**, from #1037 plus
#1041. Everything below was measured in this run, same machine, same commit:

| configuration | wall | outcome |
|---|---|---|
| baseline (`forks`, isolated) | **158.1s** | green |
| `--pool=threads` | 153.1s | green — marginal, not worth doing alone |
| #1037 only (throttle off under test) | 149.1s | green |
| #1041 only (two-project split) | 139.2s | green, 3703/3703 |
| **#1037 + #1041** | **114.2s** | green |
| whole-suite `--pool=threads --no-isolate` | **74.4s** | **9 files / 31 tests fail** |

The phase breakdown explains where the time is, and it is not in the tests:

```
Duration 147.07s (transform 10.08s, setup 19.69s, import 225.88s, tests 72.67s, environment 83.10s)
```

**Aggregate import time is 3× aggregate test time.** That is the cost of
re-isolating 175 module graphs. For the 85 files that use neither jsdom nor
`vi.mock`, isolation buys nothing that `setupStore()`'s teardown does not
already provide, and dropping it takes that bucket from 48.4s to 28.0s with all
2,638 tests still passing (import 91.0s → 8.1s).

**On the strictness trade you asked about**: the aggressive option is real and
was measured — whole-suite `--no-isolate` is 74.4s, a 53% cut — and it is **not
worth taking**. The 31 failures are `vi.mock` registry bleed and IndexedDB
teardown leaking between files in a shared worker, which is not a matter of
fixing a handful of tests; it is the isolation those 90 files are relying on.
The two-project split gets the majority of the available win from the half of
the suite that provably does not need isolation, and leaves the half that does
untouched. That is the right line, and #1041 draws it there.

Two caveats recorded honestly. First, "provably" overstates one run:
`--sequence.shuffle` on the pure project is a precondition in the issue,
because module singletons could make the bucket order-dependent in a way a
single green run would not reveal. Second, the e2e suite's 15.6 minutes here is
an artifact of this sandbox's proxy stalling a Google Fonts request, not a
repo problem — see the coverage statement.

## 6. Looked at and deliberately not filed

Recorded so the next run does not spend budget re-deriving them.

- **Test-specific lint plugins (`@vitest/eslint-plugin`,
  `eslint-plugin-testing-library`, `eslint-plugin-jest-dom`).** Dry-run:
  326 hits across 49 files. On inspection the yield is near zero. All 8
  `vitest/expect-expect` hits are custom assertion helpers
  (`assertCollapseTotality`, `assertSourceFidelity`) and would be silenced by
  `assertFunctionNames`; all 5 `vitest/valid-expect` hits are false positives
  — vitest supports `expect(value, message)` and `coverageConfig.test.ts:61`
  uses it deliberately. `no-focused-tests` and `no-disabled-tests` find
  **nothing**, because there are no `.only` or `.skip` tests anywhere in the
  suite. The 182 `testing-library/no-node-access`/`no-container` hits are
  concentrated in tests of a focus trap, a virtualizer scaffold and geometry,
  where DOM access is the subject. Not worth the config surface today.
- **Worker typecheck and tests run twice per PR** — once inside `build.yml`
  (via `pnpm run build` and `pnpm run test:coverage`, which both fan out) and
  again in `ci.yml`'s `worker-checks` job. The jobs run in parallel, so this
  costs a runner rather than wall time, and it gives worker-only changes
  faster independent feedback. Judged a reasonable design, not a finding.
- **`src/test-utils/setup.ts`'s polyfill comments say "jsdom 29"** while
  `package.json` pins `^30.0.1` (one comment does say "jsdom 30 still doesn't
  implement this either"). The `??=` guards make them harmless either way.
  Cosmetic; not worth a PR on its own, worth fixing opportunistically.
- **jsdom opt-ins are well curated.** 85 of 175 files opt in; spot-checking the
  least DOM-looking candidate (`onboarding/tourState.test.ts`, zero
  `document.`/`window.` references) confirmed it genuinely needs jsdom for
  `localStorage` and `Storage.prototype`. No easy environment wins here.
- **`e2e/` depends on `fonts.googleapis.com` on every one of 126 tests**, via a
  render-blocking `<link>` at `index.html:54`, and `contrast-sweep.spec.ts`
  samples rendered text pixels after awaiting `document.fonts.ready` — so a CDN
  outage could in principle shift the counts its per-combo `FLOOR` ratchet
  pins. Evidence against filing: in this run the fonts failed to load entirely
  and all 126 tests still passed, so the risk is latent rather than
  demonstrated. Worth knowing if the ratchet ever moves unexplained.

## 7. Survey file

`plans/surveys/health.md` was updated in a separate commit on this branch with
the process learnings from this run — chiefly that the Budget's timing advice
needs a "measure the per-*file* cost, not just the wall clock" step (the
biggest finding here, #1037, is invisible in wall-clock time because three
other workers absorb it), and that the "check docs against tooling" rule should
extend to checking a measured anomaly against the *environment* before filing
it (the e2e timing would have been a confidently wrong finding). See that
commit's diff.
