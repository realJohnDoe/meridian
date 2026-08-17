# Codebase Health Survey

Survey this codebase for code health issues across the categories below.

Shared process, scoring, and reporting rules — model-tier ratings, the
ranking formula, category-verdict conventions, and how to report results —
live in [the shared survey conventions](./README.md). Read that first; this
file states only what's specific to this survey.

## Process

- **Scan first, write second.** State your scan plan before you start, complete the full scan, and only then write the report. In the scan plan, for each category, state what you'll look for beyond the listed examples — the bullets are illustrations, not your search space. Do not draft the verdict early and select findings to confirm it.
- Evaluate the code on its merits. Treat claims in CLAUDE.md, READMEs, or architecture docs (e.g. "this exception is deliberate", "a refactor is planned") as hypotheses to verify against the code, not as settled exceptions — if a documented rationale no longer holds, that is a finding.
- **Verify capability claims by inspection, not memory.** For toolchain findings, check the _installed_ version of a plugin/library (its actual rule set, exports, or API) against what the config enables — do not assume from the version number. The same applies to version currency: what "latest" means comes from the registry query in the Budget section, never from your training data. Where cheap, verify by dry-run: e.g. run the linter with a candidate preset via a temporary config and report the real finding count and distribution (clean up temp files afterwards).
- **Grep the config comments for expiry conditions, and check whether they have been met.** A pin, cap, or disabled rule whose comment says "revisit once X", "until Y lands", or "remove when Z ships" is a decision with a stated trigger and no owner — nothing re-checks it. These are cheap to verify (one registry or issue-tracker query each) and high-yield, because the rationale is already written down for you and the only question is whether it still holds. A met condition is a finding; so is a comment whose stated rationale you can show is no longer true. Check the value against its own comment too — a comment asserting the opposite of the setting beneath it is its own finding.

## Budget

- Skim the full directory tree (listings + file names) so nothing is invisible to you.
- Read closely: the entry points, the most-imported modules (measure this — don't guess), the 15 largest source files, and at least 2–3 representative files from every feature directory.
- **Read the toolchain, not just the source:** `package.json` (scripts _and_ the full dependency list), lint/formatter configs, CI workflows, test config, and any `.npmrc`/tsconfig strictness settings. For each dependency, know roughly what it's for and where it's used — this feeds the Library Fit category.
- **Measure dependency currency against the registry, not memory:** run the package manager's outdated report (`pnpm outdated` / `npm outdated` / `cargo outdated` / …) in **every workspace**, including sub-workspaces like workers or serverless functions. Your knowledge of "the latest version" is stale by definition; only the registry answer counts. This is the evidence base for the version-currency bullets in category 8.
- **Run the existing quality gates once** — build, lint, test (plus coverage, if configured), any dead-code check, and the dependency **audit** — and report each gate's pass/fail status in the coverage statement. A failing gate is itself a finding (usually a high-impact one), and the dry-run comparisons above need this green baseline to diff against. Run the audit at a **lower severity threshold than CI gates on**: advisories sitting just under the CI threshold are invisible from a green pipeline, and in a repo that already pins vulnerable transitives deliberately, an unpinned one is a gap in an established practice rather than a fresh judgement call.
- **Establish which workspace each gate actually covers, and record it as a matrix.** Do not assume a root-level `build`/`test` script reaches a sub-workspace — verify it (e.g. does the root test runner's `include` glob match the sub-package? does the root `tsc -b` reference its tsconfig?) and list the gates on one axis against the workspaces on the other. A package that CI checks in a separate job but the documented local command silently skips is a real finding, and it is invisible unless you build this matrix: every gate is green, and the gap only shows in what each one *ran on*. This is the single cheapest high-yield check in this section for any repo with more than one package.
- **Sample git history for co-change patterns** (e.g. `git log --name-only` over recent commits) — this is the evidence base for co-location findings; don't assert "these files change together" from intuition.
- **Identify where development is currently concentrated** — sample recent history over a meaningful window (e.g. `git log --since="60 days ago" --name-only`, or recent merged PRs if available) and tally which directories see the most commits/PRs. This is the evidence base for the activity weighting in the Scoring guidance: findings in "hot" directories are worth more to fix than equivalently-scored findings in dormant corners of the codebase, because more code keeps landing on top of the problem in the meantime.
- Sample the rest. Do not skip a directory entirely without recording it in the coverage statement.

## Output structure

**Reporting:** write findings to `health-survey-results.md` in this
directory, per the [shared reporting conventions](./README.md#reporting) —
including suggested improvements to this survey file itself.

### 1. Health verdict (~5 sentences)

A plain-language summary of the repo's overall health. Name the **worst one or two areas** (by directory or subsystem, e.g. "the `auth/` layer" — not individual findings) and the **single biggest structural theme** running through the findings — explicitly consider whether that theme is **overengineering** (abstraction, configuration, or indirection outpacing the problem's actual complexity) as often as you'd consider underengineering (leakage, duplication, missing boundaries). Complexity added without a present need is exactly as much a health problem as complexity avoided where it was needed — weigh both with the same seriousness. This is the headline answer; the list below is the supporting evidence.

### 2. Coverage statement

- Which directories/files you examined closely, which you only sampled, and which you skipped — with the reason (irrelevant, generated, vendored, too large, ran out of budget, etc.).
- The pass/fail status of each existing quality gate (build, lint, test, coverage if configured, dead-code check, audit) from the single run required in the Budget section. In a multi-workspace repo, give this as the **gate × workspace matrix** the Budget section asks you to build, not a flat pass/fail list — a flat list cannot express "green, but it never looked at this package."
- Roughly what fraction of the codebase this report is based on.
- Any area you suspect has issues but did not have budget to investigate — flag it as "unverified."

### 3. Category verdicts

One line per category (1–10). Verdicts follow the
[shared convention](./README.md#category-verdicts): **clean** /
**findings: #N, #M** / **partially assessed**.

### 4. Findings

For each finding, output:

- **Title** — short label
- **Category** — one or more tags from: `architecture` `overengineering` `layout` `dry` `srp` `dead-code` `types` `error-handling` `testing` `styling` `ux` `performance` `security` `dependencies` `naming` `toolchain` `library-fit`
- **Impact** — 1–10 (10 = catastrophic/systemic; 5 = e.g. a DRY violation duplicated across ~4 files, or a missing error state on a primary user flow; 1 = trivial/cosmetic)
- **Breadth** — number of **files** affected. Counts must come from an actual search (grep/glob), and you should be able to name the search you ran; if you estimated instead, write "est." next to the number.
- **Recommended model** — tier per the [shared rubric](./README.md#recommended-model-tiers). Here, **how the fix fails** is the tell: a wrong-but-plausible change that breaks the build, a type-check, or a test is far safer to hand down-tier than one that fails silently (a re-hidden bug class, a lint rule that passes but no longer catches what it should, a "dead" export that's actually reached dynamically, a boundary that still resolves but now leaks). Reserve plan mode + multi-PR for findings that need an architecture change **or** a product decision the user should make (e.g. "narrow the type" vs "restructure the module boundary"). Example hazard note: "Sonnet 5 if the import boundary to preserve is specified in the task; else Opus 5."
- **Evidence** — at least one file path plus a short **verbatim code quote** from that file (line number optional). The quote must be copy-pasted, not paraphrased — I will spot-check by grepping for it. For toolchain findings, the evidence may be a config quote plus a dry-run result.
- **Problem** — one sentence: what is wrong and why it matters
- **Fix** — one sentence: what the concrete fix looks like

Rank and report findings per the [shared convention](./README.md#ranking-findings). Here, "confirming" a fix means re-running the build, lint, or the test suite — naming the workspace it must be run in, since a root-level command may not cover the package the fix touched.

When the ranking formula puts a low-impact finding above a high-impact one (a wide, cheap toolchain fix outranking a narrow correctness bug, say), **say so in one line under the summary table** and name which finding a reader sorting by raw impact should look at first. The formula is a default order, not a claim about what matters most, and silently shipping an inverted order makes the table read as the latter.

**Strongly prefer systemic and structural issues over isolated, line-level ones.** A finding that affects 10 files beats one that affects 1 function. Cite real code — no generic observations.

List the **top 10 findings**, numbered (the category verdicts above reference these numbers). Include all findings that make the top 10 regardless of their impact score — if a 1/10 ranks in (high breadth, trivial fix), include it and let its low Impact score speak for itself.

Do not pad to reach 10 — if fewer than 10 clear issues exist, stop there.

---

## Categories to scan — ranked by priority

The category ranking is a tiebreaker, not a filter. A serious finding in any category always outranks a minor finding in a higher-priority category — never omit a high-impact issue because its category ranks lower.

**The bullets under each category are illustrative examples, not the category's boundary.** Each category is defined by its heading and scope line; report any finding that fits the scope, including issue types not listed. If a finding matches a category's scope but no bullet, that is not a reason to drop it — it may even be more valuable, since it's something the checklist didn't anticipate.

### 1. Architecture & Domain Separation _(highest weight — prefer findings here)_

**Scope:** whether responsibilities live in the right modules and the dependency structure between them is sound. This category owns **module-level** concern sprawl; function/component-level SRP belongs in category 6.

Examples (not exhaustive):

- Domain leakage — logic belonging to one domain (auth, billing, data-fetching, UI state) leaking into another layer or domain
- God files / god modules — a single file or module accumulating logic from unrelated domains; heuristic: its imports (or importers) span 3+ feature directories that are otherwise unrelated to each other
- A concern split across too many files with no clear owner — the reader must open 4+ files to follow one behavior end to end
- Missing or misplaced boundaries — absence of a clear API surface between subsystems (e.g., feature modules that import directly from each other's internals)
- Circular or upward dependencies — lower-level modules importing from higher-level ones
- Pierced abstractions — an interface/port exists but is bypassed in practice:
  `instanceof` checks on a concrete implementation, an orchestrator importing
  one specific adapter of an interface it otherwise consumes abstractly, or an
  implementation-specific concern (auth, retries, caching) handled outside the
  interface instead of behind it

### 2. Simplicity & Overengineering _(highest weight — prefer findings here)_

**Scope:** whether the code's complexity is proportional to the problem it actually solves right now — unnecessary abstraction, premature generalization, and configuration or indirection that outpaces the real variance in use. This category owns **structural and speculative** over-engineering; function-level clarity and duplication (the opposite failure mode — too little abstraction) belongs in category 6 (Code Health & DRY). The same code can be over- and under-engineered in different spots; report both where you find them, and don't let a strong finding in one category talk you out of looking for the other.

Hold every abstraction to a "does a second real caller exist today?" test, not "might this be useful later?" — per the Process section, treat any comment or doc claiming a pattern is "for future extensibility" or "in case we need X" as a hypothesis to verify against actual call sites, not a settled justification. An interface, config knob, or generic parameter with no second consumer is a finding, not a design choice, until proven otherwise by a real second use.

Examples (not exhaustive):

- Unnecessary abstraction layers — an interface, factory, plugin/strategy system, or dependency-injection seam with exactly one real implementation and no second implementation on the horizon
- Speculative generality — config flags, extension points, options objects, or generic type parameters built for an imagined future need, where a grep for consumers shows zero call sites exercising the variance
- Indirection that doesn't earn its keep — a wrapper/service/manager/hook that only forwards to another call with no added behavior, validation, or error handling of its own (verify by reading the function body, not the name)
- Configuration surface disproportionate to actual variance — an options object, env var set, or settings panel with far more knobs than the codebase (or its users) ever set away from the default; count how many of the options are ever passed a non-default value
- Premature abstraction — logic extracted into a shared utility/hook/base class after only one real use case exists, where inlined duplicate code would have been clearer and cheaper to change independently (this directly violates the "three similar lines is better than a premature abstraction" principle most codebases and CLAUDE.md-style guides already state — check whether the codebase is actually holding itself to it)
- Framework or pattern misuse for a scale the project doesn't have — e.g. a state-machine library, event bus, or generic rules engine solving a problem a handful of `if` statements would solve just as clearly
- Defensive code for scenarios that cannot occur — validation, fallbacks, null-checks, or try/catch for inputs or states the type system, call graph, or upstream validation already rules out
- Layered configurability — a setting that is itself configurable, or an abstraction with its own plugin system, where the underlying thing being configured has one or two real variants in practice

### 3. Directory & File Layout _(high weight)_

**Scope:** whether the directory tree's shape matches how the code is actually used, changed, and depended upon.

Examples (not exhaustive):

- Co-location violations — files that always change together (verify against git history, per Budget) but live far apart; or files co-located that have no logical relationship
- Depth mismatch — a module's position in the directory tree should reflect its dependency footprint: broadly used or broadly dependent code belongs at a higher level (e.g. `lib/`, `shared/`, or a feature root), while code with a single consumer or a single dependency should live within or directly beside that consumer's subdirectory; flag modules that are either too shallow for how narrowly they're used, or too deeply nested for how widely they're shared
- Inconsistent module conventions — some features use `feature/index.ts` barrel exports, others do not; or naming conventions differ across domains without reason
- Layout that fights the framework — e.g., route files that aren't co-located with their route, server-only code inside `components/`, shared utilities scattered across feature folders
- Flat directories that should be split, or deeply nested directories that should be flattened

### 4. Security

**Scope:** any way an attacker or malicious input could compromise the app, its data, or its users — evaluated against this app's actual threat model (state what that model is: what's client-side, what's persisted where, what external input is parsed).

Examples (not exhaustive):

- XSS vectors: `dangerouslySetInnerHTML`, unescaped user input rendered as HTML, user-controlled URLs in `href`/`src` (`javascript:` schemes)
- Sensitive values hardcoded or exposed to the client bundle; tokens/credentials persisted in insecure storage
- Security-relevant logic only enforced client-side
- Untrusted-input parsing without sanitization (markdown/HTML rendering, file names, path traversal in user-supplied paths)
- Anything else in scope — injection, missing origin checks on `postMessage`, known-vulnerable dependency versions, etc.

### 5. Testing & Error Handling

**Scope:** whether failures — in code or in tests — are detected, surfaced, and recoverable.

Examples (not exhaustive):

- Core domain logic with no test coverage at all, or coverage concentrated on trivial code while the risky paths go untested
- Tests that can't fail meaningfully — over-mocked tests, snapshot rot, assertions on implementation details
- Swallowed errors — empty or log-only `catch` blocks, unhandled promise rejections, errors caught without surfacing to the user or a recovery path
- No consistent error strategy — each layer inventing its own mix of throw / return-null / silent-default

### 6. Code Health & DRY

**Scope:** the local quality of the code — duplication, clarity, cohesion, and type discipline at the function and file level. This category owns duplication (too little sharing); structural over-abstraction (too much sharing, too soon) belongs in category 2.

Examples (not exhaustive):

- DRY violations — duplicated logic that should be a shared utility or hook, especially across feature boundaries (only past the point where a second real use case exists — see category 2 on premature extraction)
- SRP violations at the function/component level — one function or component doing several unrelated jobs (module-level sprawl belongs in category 1)
- Redundant layered guards — the **same check on the same value** repeated at both the call site and inside the callee (or across 3+ layers of one call path) with no documented ownership of the invariant
- Naming — misleading, ambiguous, or inconsistent names across a module boundary (e.g. the same concept called different things in different layers, or a name that no longer reflects what the code does)
- Dead code — unreachable paths, unused exports, or unused imports at module boundaries (not just individual variables)
- Type safety — pervasive use of `any`, missing return types on public API surfaces, unsafe casts

### 7. Toolchain & Developer Feedback Loops

**Scope:** whether the project's tooling catches the mistakes this codebase actually makes — and catches them as early and cheaply as possible.

Examples (not exhaustive):

- Installed-but-unused lint capability — a lint plugin whose installed version ships rules or presets the config doesn't enable (compare the plugin's actual rule list against the config; dry-run the candidate preset and report what it flags)
- Missing type-aware linting where it would catch real bug classes in async-heavy code — first check whether the relevant rules are already enabled, then dry-run the missing ones and report what they actually flag
- Documented invariants not machine-enforced — an architecture rule stated in CLAUDE.md/docs (layer purity, import direction, "X never imports Y") that no lint rule or CI check actually guards; propose the enforcing rule
- Missing dead-code and unused-dependency detection (e.g. knip) when unused exports are accumulating; missing coverage measurement when test gaps are a finding
- CI/local drift — checks that run locally but aren't gated in CI, or CI steps with no local equivalent
- Formatter: note presence/absence and whether adopting one actually fits this project. Consider the authorship model (a single-author or agent-written codebase with consistent deliberate style may be right to skip one) and the migration cost — evaluate the trade-off, don't reflexively recommend adding it
- Recommend against tools too: fast lint/format replacements that can't replicate existing custom rules, or pre-commit hooks that duplicate CI, are anti-recommendations worth stating

### 8. Dependencies & Library Fit

**Scope:** whether each dependency earns its place, whether custom code should be a dependency — in both directions — and whether the installed versions are current and fully exploited.

Evaluate in **both directions**, and say explicitly when the status quo is correct. When recommending upgrades, give a sequencing (one PR per risky major, safe minors batched) and name the command whose green run counts as the verdict. Examples (not exhaustive):

- **Custom code reimplementing an installed library's feature** — a hand-rolled implementation sitting next to a dependency that already does it correctly (e.g. raw millisecond date math beside a date library); includes cases where a library capability is switched off in config and replaced by weaker custom code — for each installed library, know its headline features and check whether the codebase re-implements any of them
- **Library used outside its core use case** — a dependency whose reason-to-exist (SSR, framework integration, scale) doesn't apply to this project, where a small custom implementation would carry less weight; note honestly when it's harmless to keep
- **Missing library** — a hand-rolled subsystem where a standard, well-maintained library is clearly better (correctness-critical parsing, protocol handling, a11y-heavy widgets)
- **Deliberate custom code that is right** — when custom beats the obvious library (domain semantics the library can't express, coupling to an owned file format, library abandonment/known defects), state the keep-custom verdict and the reason instead of reflexively recommending the library
- **Version currency (measured, per Budget)** — from the outdated report, give each major-version gap its own verdict: upgrade now / try on a branch (name the gating risk, e.g. a plugin or typed-lint compat matrix) / deliberately held back — and for held-back ones, check whether the reason still exists. Batch the safe patch/minor sweep into one line. Audit pinned ranges (`~x.y.z`, exact pins): a pin is a standing decision, so flag pins whose original rationale no longer holds
- **Successor patterns** — a dependency superseded by a newer generation or an absorbed capability (e.g. a hand-installed types package replaced by the tool's own type generator, a plugin folded into the platform, a maintained fork replacing an abandoned original); recommend the successor, not just the version bump
- **Unused newer features of installed dependencies** — the installed major already supports an idiom the code predates (e.g. ref-as-prop where components still use `forwardRef`, a TS `lib`/`target` bump that would delete casts or polyfills, a config flag replacing a workaround); flag it when adopting the feature deletes code, and say honestly when it isn't worth the churn
- **Runtime alignment over recency** — version choices that should track a deployed runtime rather than "latest" (e.g. `@types/node` vs the Node version CI and production actually run); flag both drift _and_ chasing latest past the runtime
- Significantly outdated or abandoned dependencies; functionality duplicated across two libraries; heavyweight dependencies used for a small fraction of their surface (flag as "watch", not necessarily "replace")

### 9. Styling & UX

**Scope:** consistency of the styling approach with the project's chosen system, and whether the UI communicates state and is usable by everyone.

Examples (not exhaustive):

- Installed UI-kit component bypassed — the project's component library (shadcn, MUI, etc.) ships a component that a custom re-implementation duplicates
- Raw CSS / inline styles where the project's styling system (e.g. Tailwind) would suffice, or utility classes used where plain CSS is clearly better
- UX anti-patterns: missing loading/error states, non-accessible interactive elements (no keyboard nav, missing ARIA)

### 10. Performance

**Scope:** work done unnecessarily, too often, or at the wrong time — at any layer: render, data, or bundle.

Examples (not exhaustive):

- React anti-patterns: object/array literals in JSX props, missing `useMemo`/`useCallback`/`memo` at component boundaries (not fine-grained)
- Missing lazy-loading / code-splitting at route or feature boundaries
- N+1 or waterfall data fetching patterns

---

**Scoring guidance:** A finding that reveals a structural pattern affecting the whole codebase (e.g., "every feature imports from `lib/` internals instead of going through a public API") scores higher than a finding about a single misused hook. Score overengineering findings by the same standard: an unnecessary abstraction repeated as the codebase's default pattern (e.g. every data-fetching hook wrapped in an unused strategy interface) is a systemic finding, not a nitpick — don't undercount it just because the fix is a deletion rather than an addition. A toolchain finding that would _mechanically catch an entire class of issues_ (e.g. enabling an installed lint preset that flags 30 real problems, or a lint zone that enforces a documented architecture invariant) scores like the class it catches, not like a config tweak. Skip findings that are purely stylistic or affect a single isolated callsite — they belong in a lint rule, not a health report. A fix that only deletes code (removing an unused abstraction, a dead config knob, an unreachable branch) is not automatically low-effort to rate at the cheapest tier — rate it by the judgment needed to confirm nothing else depends on what's being deleted, per the Recommended model guidance above. **Weight by where development is actually happening:** using the recent-history sample from the Budget section, treat a finding in a directory under active development as more valuable than an equivalently-scored finding in a dormant one — fixing it now is cheaper than after more code accretes on top of the problem, and it's more likely to actually get picked up. Note this pull in the finding itself (e.g. "`editor/` has had N commits in the last 60 days — highest churn in the repo") rather than silently baking it into the rank, so the reader can see the reasoning and re-sort past it if they only care about raw impact.
