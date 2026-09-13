# Codebase Health Survey

Survey this codebase for code health issues across the categories below.

Shared process, scoring, and reporting rules — model-tier ratings, the ranking
formula, category-verdict conventions, and how to report results — live in [the
shared survey conventions](./README.md). Read that first; this file states only
what's specific to this survey.

## Scope — `src/` or the test suite, and say which

The ten categories apply to production code and to test code alike, but not in the same run, because the Budget doesn't: "the 15 largest source files", ranked over "non-generated **non-test** sources", assumes `src/`. Name the corpus in the first line of the coverage statement and re-point the Budget to match — a test-suite run ranks the largest *test* files, reads the test config, helpers and fixtures as its toolchain, and treats production modules as the thing under test rather than the thing surveyed.

Say it explicitly, because leaving it implicit cost every prior run: test code had never been surveyed at all, not because anyone judged it low-value but because nothing said it was in scope. The 2026-09-12 run re-pointed these categories at the suite (#1065) and was the highest-yield run to date — ten findings, all ten fixed inside ~30 hours — and they transferred with no amendment: `dry` over duplicated fixtures and hand-rolled router mocks, `dead-code` over a 232-line file whose subject was a hand-written copy of production, `performance` over the suite's own 226s of redundant isolation.

## Process

Per [Running a survey](./README.md#running-a-survey): scan plan first, evaluate on merits, verify capability claims by inspection. Version currency comes from the registry query in the Budget, never from training data. Three rules are specific to this survey:

- **Check the docs against the tooling, in both directions.** The shared conventions say to treat `CLAUDE.md` and comment claims as hypotheses; the half that gets forgotten is that a doc warning a gap *exists* goes stale exactly as easily as one claiming it doesn't. "Nothing enforces X" and "you have to remember to add Y" are claims to verify against the scripts, lint config and CI — and when a guard has since been written, the stale warning is its own finding, because it teaches every future reader to distrust a check that works. The 2026-09-06 run found `CLAUDE.md`'s "Route shells" section still warning that a new route escapes the layout checks until someone lists it, when `e2e/layout-smoke.spec.ts` already carried a `findUncoveredRoutes()` failing CI on exactly that. **Verify the path before citing it, this paragraph included:** that check was `scripts/layout-smoke.mjs`/`assertRouteCoverage()` when the example was written, #1014 moved it, and this paragraph went on naming the old pair for a week. The survey file is as liable to the rot as the docs it tells you to distrust.
- **Grep the config comments for expiry conditions, and check whether they have been met.** A pin, cap or disabled rule whose comment says "revisit once X", "until Y lands" or "remove when Z ships" is a decision with a stated trigger and no owner — nothing re-checks it. Cheap to verify (one registry or tracker query each) and high-yield, because the rationale is already written down and the only question is whether it still holds. A met condition is a finding; so is a comment whose stated rationale you can show is no longer true, or one asserting the opposite of the setting beneath it.
- **Attribute a measured anomaly to the environment before you attribute it to the repo.** On 2026-09-12 all 126 e2e tests took a near-identical ~14.5s, reading exactly like a repo-wide harness defect; probing showed browser launch at 235ms, every local request inside 95ms, and the remaining 12.6s a render-blocking Google Fonts `<link>` stalling against *this sandbox's* egress proxy. On a normal runner that cost doesn't exist. Before filing any timing, network or resource finding, isolate the suspect with a throwaway probe and say in the coverage statement whether the environment is implicated — a uniform per-unit cost across otherwise unrelated units is the tell.

## Budget

- Skim the full directory tree (listings + file names) so nothing is invisible.
- Read closely: the entry points, the most-imported modules (measure this — don't guess), the 15 largest source files, and 2–3 representative files from every feature directory. **Rank "largest" by line count over non-generated non-test sources** — byte-size ranking reshuffles the list, since a file heavy on prose comments outranks denser code. State which files the ranking picked, so a reader can tell where the budget went. On a test-suite run this inverts, per [Scope](#scope--src-or-the-test-suite-and-say-which).
- **Read the toolchain, not just the source:** `package.json` (scripts *and* the full dependency list), lint/formatter configs, CI workflows, test config, `.npmrc`/tsconfig strictness. For each dependency, know roughly what it's for and where it's used — this feeds category 8.
- **Measure dependency currency against the registry, not memory:** run the outdated report in **every workspace**, including sub-workspaces like `worker/`. Your knowledge of "latest" is stale by definition; only the registry answer counts.
- **Run the existing quality gates once** — build, lint, test, coverage, dead-code check, and the dependency **audit** — and report each one's status. A failing gate is itself a finding, usually a high-impact one, and the dry-run comparisons below need a green baseline to diff against. Run the audit **from inside each workspace directory** (`pnpm audit` takes no `--filter`, and reaching for one fails with an unrelated `Unknown option: 'recursive'` that reads like a broken tool rather than the wrong invocation), and at a **lower severity threshold than CI gates on** — advisories sitting just under the CI threshold are invisible from a green pipeline.
- **Establish which workspace each gate actually covers, and record it as a gate × workspace matrix.** This is the single cheapest high-yield check in the section for any repo with more than one package, and it is invisible without the matrix: every gate is green, and the gap only shows in what each one *ran on*. Give **coverage its own row, separate from `test`** — the common shape is a `test` script that fans out to every workspace beside a `test:coverage` script that does not. Don't assume a root-level `build`/`test` reaches a sub-workspace; verify it (does the root runner's `include` glob match? does the root `tsc -b` reference its tsconfig?). A sub-package whose own test config has no `coverage` block is the same finding from the other side.
- **The coverage floors are machine-checked now — audit the guard, don't redo it by hand.** Floor drift was this budget's most expensive recurring item: three runs in a row diffed `vitest.config.ts`'s 57 per-file floors against measured coverage by hand, and the third still had to re-derive the four globals the first two skipped. A floor more than ~10 points under the file it guards is guarding nothing, and `src/coverageConfig.test.ts` now enforces exactly that (its comment cites this line, so keep the wording) — it fails when any floor **per-file or global** sits more than 10 points under measured, when a threshold key names a file that no longer exists, and when a `src/routes/` coverage exclusion has grown past 100 lines. `pnpm run test:coverage` runs it and CI runs that, so a drifted floor is red rather than a survey finding. Report the guard's own status in the matrix and spend the budget on what it *cannot* see:
  - a file with **no threshold key at all** — the guard only checks floors someone remembered to write, so an unguarded integrity-critical file is invisible to it, which is the shape the 2026-09-06 `src/storeCommit.ts` finding would take today;
  - an `exclude` glob **outside `src/routes/`** (`src/components/ui/**` is excluded on authorship, deliberately);
  - whether its own hard-coded constants still fit the repo — the 10-point tolerance and the 100-line "this is just route registration" bound are judgement calls with a stated rationale, so the expiry-condition rule above applies to them.
- **Measure the test suite per file, not just as a wall-clock total, and read the phase breakdown.** A slow file is invisible in wall-clock time when other workers absorb it — on 2026-09-12 one file was 27.2s of a 99s total (27% of all CPU the suite spent, 4× the next slowest) while removing it moved the *wall* clock only 158.1s → 149.1s, so a survey watching the total would have scored it a non-finding. Run `vitest run --reporter=json`, rank files, then rank tests within the worst; a cluster at a suspiciously round duration (16 tests at ~1000ms each, there) means real time is being slept, not spent. Vitest's `transform / setup / import / tests / environment` summary is the other half: when `import` is several times `tests`, the suite is paying for isolation rather than assertions, and the question is which files actually need it.
- **Build the app and look at what shipped, not just at what was written.** Run the production build, rank the emitted chunks by size, then grep the largest for markers of the heavy dependencies (`cm-content` for CodeMirror, `rdp-` for react-day-picker, `Dexie`, `embla`) to establish which chunk each landed in. A `React.lazy` or route-level split can be silently defeated by one static import of a barrel elsewhere — a bug invisible to every other item here, because every file involved reads correctly on its own. When a suspect turns up, **measure rather than argue**: change it, rebuild, diff the entry chunk's raw and gzip size. On 2026-09-06 one import line in `routes/__root.tsx` was worth 53% of the entry chunk (465,525 → 218,894 bytes gzip).
- **Sample git history for co-change patterns and to find where development is concentrated** (`git log --name-only` over a meaningful window, or recent merged PRs). This is the evidence base for co-location findings and for the activity weighting in Scoring — don't assert "these files change together" from intuition. [Un-shallow the clone first](./README.md#running-a-survey), and record the history's true span next to any tally.
- Sample the rest. Don't skip a directory entirely without recording it.

## Output structure

**Reporting:** per the [shared reporting conventions](./README.md#reporting), including suggested improvements to this survey file itself.

### 1. Health verdict (~5 sentences)

The repo's overall health in plain language. Name the **worst one or two areas** (by directory or subsystem — not individual findings) and the **single biggest structural theme** running through the findings. Explicitly consider whether that theme is **overengineering** — abstraction, configuration or indirection outpacing the problem's real complexity — as readily as underengineering. Complexity added without a present need is exactly as much a health problem as complexity avoided where it was needed.

### 2. Coverage statement

Which directories you examined closely, sampled, or skipped, with the reason. The **gate × workspace matrix** from the Budget, not a flat pass/fail list — a flat list cannot express "green, but it never looked at this package". Roughly what fraction of the codebase this rests on. Any area you suspect has issues but lacked budget to investigate, flagged "unverified".

### 3. Category verdicts

One line per category (1–10), per the [shared convention](./README.md#category-verdicts).

### 4. Findings — top 10, numbered

Findings carry the [shared fields](./README.md#finding-fields). This survey adds:

- **Category** — one or more of: `architecture` `overengineering` `layout` `dry` `srp` `dead-code` `types` `error-handling` `testing` `styling` `ux` `performance` `security` `dependencies` `naming` `toolchain` `library-fit`
- **Impact** — 1–10 (10 = catastrophic/systemic; 5 = a DRY violation across ~4 files, or a missing error state on a primary flow; 1 = trivial/cosmetic)
- **Task context** — the block described in [writing findings down to Sonnet 5](./README.md#write-findings-down-to-sonnet-5-where-you-honestly-can)

**Fails silently here:** a re-hidden bug class, a lint rule that passes but no longer catches what it should, a "dead" export that's actually reached dynamically, a boundary that still resolves but now leaks. Reserve plan mode + multi-PR for an architecture change **or** a product decision ("narrow the type" vs "restructure the module boundary"). Hazard note example: "Sonnet 5 if the import boundary to preserve is specified in the task; else Opus 5." "Confirming" a fix means re-running the build, lint or test suite — **naming the workspace it must run in**, since a root-level command may not cover the package the fix touched.

When the formula puts a low-impact finding above a high-impact one (a wide cheap toolchain fix outranking a narrow correctness bug), **say so in one line under the summary table** and name which finding a reader sorting by raw impact should look at first. The same note covers the other distortion: when a real finding falls out of the top N purely on effort — usually an architecture finding, both the highest-weight category and the most expensive to fix — name it in one line below the findings rather than dropping it silently, so "category 1: clean" never appears when the truth is "category 1's finding didn't survive the divisor".

---

## Categories to scan — ranked by priority

Bullets are illustrations, not your search space — see [Running a survey](./README.md#running-a-survey). A finding that matches a scope but no bullet may be *more* valuable, not less: it's what the checklist didn't anticipate.

### 1. Architecture & Domain Separation _(highest weight — prefer findings here)_

**Scope:** whether responsibilities live in the right modules and the dependency structure between them is sound. This category owns **module-level** concern sprawl; function/component-level SRP belongs in category 6.

- Domain leakage — logic belonging to one domain (auth, data-fetching, UI state) leaking into another layer
- God modules — one file or module accumulating logic from unrelated domains; heuristic: its imports or importers span 3+ otherwise-unrelated feature directories
- A concern split across too many files with no clear owner — the reader must open 4+ files to follow one behavior end to end
- Missing or misplaced boundaries — feature modules importing each other's internals rather than a public surface; circular or upward dependencies
- **Pierced abstractions** — an interface or port that exists but is bypassed in practice: `instanceof` checks on a concrete implementation, an orchestrator importing one specific adapter of an interface it otherwise consumes abstractly, or an implementation-specific concern (auth, retries, caching) handled outside the interface instead of behind it

### 2. Simplicity & Overengineering _(highest weight — prefer findings here)_

**Scope:** whether complexity is proportional to the problem actually being solved right now. This category owns **structural and speculative** over-engineering; function-level duplication — the opposite failure — belongs in category 6. The same code can be over- and under-engineered in different spots; report both, and don't let a strong finding in one talk you out of looking for the other.

Hold every abstraction to a **"does a second real caller exist today?"** test, not "might this be useful later?" Per the Process section, treat any comment claiming a pattern is "for future extensibility" as a hypothesis to verify against actual call sites. An interface, config knob or generic parameter with no second consumer is a finding, not a design choice, until a real second use proves otherwise.

- Unnecessary abstraction layers — an interface, factory, strategy system or DI seam with exactly one implementation and no second on the horizon
- Speculative generality — config flags, extension points, options objects or generic type parameters built for an imagined need, where a grep for consumers shows zero call sites exercising the variance
- Indirection that doesn't earn its keep — a wrapper/service/manager/hook that only forwards, with no added behavior, validation or error handling of its own (verify by reading the body, not the name)
- Configuration surface disproportionate to actual variance — count how many options are ever passed a non-default value
- Premature abstraction — logic extracted into a shared utility after one real use case, where inlined duplication would have been clearer and cheaper to change independently. Most CLAUDE.md-style guides already state this principle; check whether the codebase holds itself to it.
- Defensive code for scenarios that cannot occur — validation, fallbacks, null-checks or try/catch for states the type system, call graph or upstream validation already rules out
- Framework or pattern misuse for a scale the project doesn't have — a state-machine library, event bus or rules engine where a handful of `if`s would be clearer

### 3. Directory & File Layout _(high weight)_

**Scope:** whether the tree's shape matches how the code is actually used, changed and depended upon.

- Co-location violations — files that always change together (verify against git history, per Budget) living far apart, or co-located files with no logical relationship
- **Depth mismatch** — a module's position should reflect its dependency footprint: broadly used or broadly dependent code belongs higher (`lib/`, a feature root), code with a single consumer belongs beside that consumer. Flag modules too shallow for how narrowly they're used, and too deep for how widely they're shared.
- Inconsistent module conventions across domains without reason; layout that fights the framework (route files not co-located with their route, server-only code inside `components/`)
- Flat directories that should be split, or deep nesting that should be flattened

### 4. Security

**Scope:** any way an attacker or malicious input could compromise the app, its data or its users — evaluated against this app's actual threat model, which you should state: what's client-side, what's persisted where, what external input is parsed.

- XSS: `dangerouslySetInnerHTML`, unescaped user input rendered as HTML, user-controlled URLs in `href`/`src` (`javascript:` schemes)
- Sensitive values hardcoded or exposed to the client bundle; tokens persisted in insecure storage
- Security-relevant logic enforced only client-side
- Untrusted-input parsing without sanitization (markdown/HTML rendering, file names, path traversal in user-supplied paths); known-vulnerable dependency versions; missing origin checks on `postMessage`

### 5. Testing & Error Handling

**Scope:** whether failures — in code or in tests — are detected, surfaced and recoverable.

- Core domain logic with no coverage at all, or coverage concentrated on trivial code while the risky paths go untested
- **Tests that can't fail meaningfully** — over-mocked tests, snapshot rot, assertions on implementation details, or a test whose *subject* is a copy of production rather than production itself. The tell is the import list: a test file that imports no function from the module named in its own header is asserting against a stand-in. Grep test files for comments admitting the coupling (`mirrors`, `must match`, `keep in sync`) — on 2026-09-12 that grep found a 232-line file whose nine tests all ran against a hand-written copy of `pushDirty`.
- **The same behaviour asserted at more than one activation level** — a pure function tested directly *and* through the component that calls it. Not automatically a fault: levels that assert genuinely different things (the logic, the wiring, the real I/O) each earn their place, and the good ones say so in their headers. It *is* a fault when the expensive level asserts nothing the cheap one does not, which it usually does by taking a callback payload rather than inspecting rendered output. Compare the per-test cost from the timing data (235ms through a React render against 0.6ms direct, in the 2026-09-12 case) and check whether the cheap level's fixtures are byte-identical to the expensive one's.
- **Tests that fail nondeterministically.** No survey looked for this until 2026-09-13, and the repo paid for five in the preceding fortnight: a fixed 120 ms real wait too tight under load (#1031, PR #1050), a fixture date colliding with the test's own "today" (PR #897), an e2e assertion racing layout (PR #887), and two harnesses accumulating state across runs (#1023, plus fake-indexeddb retaining every transaction a soak opened, under #1052). The greps that find the class: `setTimeout` or `await new Promise` inside a test body (a *real* wait, not a fake timer), `new Date()`/`Date.now()` with no `vi.setSystemTime` nearby, and a module-level `let` or cache in a shared helper that no `beforeEach` resets. Rate these above their apparent size — a flake teaches everyone to re-run CI instead of reading it, which disarms every other gate in the matrix.
- Swallowed errors — empty or log-only `catch` blocks, unhandled rejections, errors caught without surfacing to the user or a recovery path
- No consistent error strategy — each layer inventing its own mix of throw / return-null / silent-default

### 6. Code Health & DRY

**Scope:** local quality at the function and file level — duplication, clarity, cohesion, type discipline. This category owns duplication (too little sharing); structural over-abstraction belongs in category 2.

- DRY violations, especially across feature boundaries — but only past the point where a second real use case exists, per category 2 on premature extraction
- SRP violations at the function/component level (module-level sprawl belongs in category 1)
- **Redundant layered guards** — the same check on the same value at both the call site and inside the callee, or across 3+ layers of one call path, with no documented ownership of the invariant
- Naming — the same concept called different things across a module boundary, or a name that no longer reflects what the code does
- Dead code — unreachable paths, unused exports, unused imports at module boundaries (not individual variables)
- Type safety — pervasive `any`, missing return types on public API surfaces, unsafe casts

### 7. Toolchain & Developer Feedback Loops

**Scope:** whether the tooling catches the mistakes this codebase actually makes, as early and cheaply as possible.

- **Installed-but-unused lint capability** — a plugin whose installed version ships rules or presets the config doesn't enable. Compare the plugin's actual rule list against the config, dry-run the candidate preset, and report the real count and distribution of what it flags.
- Missing type-aware linting where it would catch real bug classes in async-heavy code — check whether the rules are already enabled first, then dry-run the missing ones
- **Documented invariants not machine-enforced** — an architecture rule stated in `CLAUDE.md` (layer purity, import direction, "X never imports Y") that no lint rule or CI check guards. Propose the enforcing rule.
- Missing dead-code or unused-dependency detection when unused exports are accumulating; missing coverage measurement when test gaps are a finding; CI/local drift in either direction
- **Recommend against tools too:** a formatter may be the wrong call for a single-author or agent-written codebase with consistent deliberate style — evaluate the trade-off rather than reflexively recommending one. Fast lint/format replacements that can't replicate existing custom rules, and pre-commit hooks duplicating CI, are anti-recommendations worth stating.

### 8. Dependencies & Library Fit

**Scope:** whether each dependency earns its place, whether custom code should be a dependency — in both directions — and whether installed versions are current and fully exploited. Say explicitly when the status quo is correct. When recommending upgrades, give a sequencing (one PR per risky major, safe minors batched) and name the command whose green run counts as the verdict.

- **Custom code reimplementing an installed library's feature** — a hand-rolled implementation beside a dependency that already does it correctly, including cases where a library capability is switched off in config and replaced by weaker custom code. For each installed library, know its headline features and check whether the codebase re-implements any.
- **Library used outside its core use case** — a dependency whose reason to exist (SSR, framework integration, scale) doesn't apply here, where a small custom implementation would carry less weight. Note honestly when it's harmless to keep.
- **Missing library** — a hand-rolled subsystem where a standard, well-maintained one is clearly better (correctness-critical parsing, protocol handling, a11y-heavy widgets)
- **Deliberate custom code that is right** — domain semantics the library can't express, coupling to an owned file format, library abandonment. State the keep-custom verdict and the reason instead of reflexively recommending the library.
- **Version currency (measured, per Budget)** — give each major-version gap its own verdict: upgrade now / try on a branch (name the gating risk, e.g. a typed-lint compat matrix) / deliberately held back, and for held-back ones check whether the reason still exists. Batch the safe patch/minor sweep into one line. Audit pinned ranges: a pin is a standing decision, so flag pins whose original rationale no longer holds.
- **Successor patterns** — a dependency superseded by a newer generation or an absorbed capability (a hand-installed types package replaced by the tool's own generator, a plugin folded into the platform, a maintained fork replacing an abandoned original). Recommend the successor, not just the bump.
- **Unused newer features of installed dependencies** — the installed major already supports an idiom the code predates (ref-as-prop where components still use `forwardRef`, a TS `lib`/`target` bump that would delete casts). Flag it when adopting the feature *deletes* code, and say honestly when it isn't worth the churn.
- **Runtime alignment over recency** — versions that should track a deployed runtime rather than "latest" (`@types/node` against the Node version CI and production run). Flag both drift and chasing latest past the runtime.
- Abandoned dependencies; functionality duplicated across two libraries; heavyweight dependencies used for a small fraction of their surface (flag as "watch", not necessarily "replace")

### 9. Styling & UX

**Scope:** consistency with the project's chosen system, and whether the UI communicates state and is usable by everyone. The [UI survey](health-ui.md) owns this in depth — report only what a general pass surfaces, and hand anything deeper to it.

- An installed UI-kit component bypassed by a custom re-implementation
- Raw CSS or inline styles where the project's system would suffice, or utility classes where plain CSS is clearly better
- Missing loading/error states; non-accessible interactive elements

### 10. Performance

**Scope:** work done unnecessarily, too often, or at the wrong time — render, data, or bundle. The [performance survey](performance.md) owns this in depth, including its rule that memoization findings need runtime render counts rather than inspection. Here, prefer the bundle and startup findings the Budget's build step surfaces, since those are measurable from a build rather than a browser.

---

**Scoring guidance:** A finding that reveals a structural pattern affecting the whole codebase ("every feature imports from `lib/` internals instead of a public API") scores higher than one about a single misused hook. Score overengineering by the same standard: an unnecessary abstraction repeated as the codebase's default pattern is systemic, not a nitpick — don't undercount it because the fix is a deletion. A toolchain finding that _mechanically catches an entire class_ (an installed preset that flags 30 real problems, a lint zone enforcing a documented invariant) scores like the class it catches, not like a config tweak. A deletion-only fix is not automatically cheapest-tier — rate it by the judgment needed to confirm nothing else depends on what's being deleted. **Weight by where development is actually happening:** using the history sample from the Budget, treat a finding in an actively developed directory as more valuable than an equivalent one in a dormant corner — fixing it now is cheaper than after more code accretes, and it's likelier to get picked up. Note that pull in the finding itself ("`editor/` has had N commits in the last 60 days — highest churn in the repo") rather than silently baking it into the rank. Skip findings that are purely stylistic at a single callsite; they belong in a lint rule.
