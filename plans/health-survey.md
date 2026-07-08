# Codebase Health Survey

Survey this codebase for code health issues across the categories below.

## Process

- **Scan first, write second.** State your scan plan before you start, complete the full scan, and only then write the report. Do not draft the verdict early and select findings to confirm it.
- Evaluate the code on its merits. Treat claims in CLAUDE.md, READMEs, or architecture docs (e.g. "this exception is deliberate", "a refactor is planned") as hypotheses to verify against the code, not as settled exceptions — if a documented rationale no longer holds, that is a finding.
- **Verify capability claims by inspection, not memory.** For toolchain findings, check the _installed_ version of a plugin/library (its actual rule set, exports, or API) against what the config enables — do not assume from the version number. Where cheap, verify by dry-run: e.g. run the linter with a candidate preset via a temporary config and report the real finding count and distribution (clean up temp files afterwards).

## Budget

- Skim the full directory tree (listings + file names) so nothing is invisible to you.
- Read closely: the entry points, the most-imported modules (measure this — don't guess), the 15 largest source files, and at least 2–3 representative files from every feature directory.
- **Read the toolchain, not just the source:** `package.json` (scripts _and_ the full dependency list), lint/formatter configs, CI workflows, test config, and any `.npmrc`/tsconfig strictness settings. For each dependency, know roughly what it's for and where it's used — this feeds the Library Fit category.
- Sample the rest. Do not skip a directory entirely without recording it in the coverage statement.

## Output structure

### 1. Health verdict (~5 sentences)

A plain-language summary of the repo's overall health. Name the **worst one or two areas** (by directory or subsystem, e.g. "the `auth/` layer" — not individual findings) and the **single biggest structural theme** running through the findings. This is the headline answer; the list below is the supporting evidence.

### 2. Coverage statement

- Which directories/files you examined closely, which you only sampled, and which you skipped — with the reason (irrelevant, generated, vendored, too large, ran out of budget, etc.).
- Roughly what fraction of the codebase this report is based on.
- Any area you suspect has issues but did not have budget to investigate — flag it as "unverified."

### 3. Findings

For each finding, output:

- **Title** — short label
- **Category** — one or more tags from: `architecture` `layout` `dry` `srp` `dead-code` `types` `error-handling` `testing` `styling` `ux` `performance` `security` `dependencies` `naming` `toolchain` `library-fit`
- **Impact** — 1–10 (10 = catastrophic/systemic; 5 = e.g. a DRY violation duplicated across ~4 files, or a missing error state on a primary user flow; 1 = trivial/cosmetic)
- **Breadth** — number of **files** affected. Counts must come from an actual search (grep/glob), and you should be able to name the search you ran; if you estimated instead, write "est." next to the number.
- **Fix effort** — S / M / L (S = localized edit; M = touches a few files or needs a small refactor; L = structural change across the codebase)
- **Evidence** — at least one file path plus a short **verbatim code quote** from that file (line number optional). The quote must be copy-pasted, not paraphrased — I will spot-check by grepping for it. For toolchain findings, the evidence may be a config quote plus a dry-run result.
- **Problem** — one sentence: what is wrong and why it matters
- **Fix** — one sentence: what the concrete fix looks like

Rank findings by a rough `(impact × breadth) ÷ effort` intuition — but report Impact, Breadth, and Fix effort as the separate fields above rather than collapsing them into one number, so the reader can re-sort by what they care about.

**Strongly prefer systemic and structural issues over isolated, line-level ones.** A finding that affects 10 files beats one that affects 1 function. Cite real code — no generic observations.

List the **top 10 findings**. Include all findings that make the top 10 regardless of their impact score — if a 1/10 ranks in (high breadth, trivial fix), include it and let its low Impact score speak for itself.

Do not pad to reach 10 — if fewer than 10 clear issues exist, stop there.

---

## Categories to scan — ranked by priority

The category ranking is a tiebreaker, not a filter. A serious finding in any category always outranks a minor finding in a higher-priority category — never omit a high-impact issue because its category ranks lower.

### 1. Architecture & Domain Separation _(highest weight — prefer findings here)_

- Domain leakage — logic belonging to one domain (auth, billing, data-fetching, UI state) leaking into another layer or domain
- Wrong abstraction level — a component or module that owns too many concerns, or a concern split across too many files with no clear owner
- Missing or misplaced boundaries — absence of a clear API surface between subsystems (e.g., feature modules that import directly from each other's internals)
- Circular or upward dependencies — lower-level modules importing from higher-level ones
- God files — single files accumulating logic from unrelated domains

### 2. Directory & File Layout _(high weight)_

- Co-location violations — files that always change together but live far apart; or files co-located that have no logical relationship
- Depth mismatch — a module's position in the directory tree should reflect its dependency footprint: broadly used or broadly dependent code belongs at a higher level (e.g. `lib/`, `shared/`, or a feature root), while code with a single consumer or a single dependency should live within or directly beside that consumer's subdirectory; flag modules that are either too shallow for how narrowly they're used, or too deeply nested for how widely they're shared
- Inconsistent module conventions — some features use `feature/index.ts` barrel exports, others do not; or naming conventions differ across domains without reason
- Layout that fights the framework — e.g., route files that aren't co-located with their route, server-only code inside `components/`, shared utilities scattered across feature folders
- Flat directories that should be split, or deeply nested directories that should be flattened

### 3. Security

- XSS vectors: `dangerouslySetInnerHTML`, unescaped user input rendered as HTML
- Sensitive values hardcoded or exposed to the client bundle
- Security-relevant logic only enforced client-side

### 4. Testing & Error Handling

- Core domain logic with no test coverage at all, or coverage concentrated on trivial code while the risky paths go untested
- Tests that can't fail meaningfully — over-mocked tests, snapshot rot, assertions on implementation details
- Swallowed errors — empty or log-only `catch` blocks, unhandled promise rejections, errors caught without surfacing to the user or a recovery path
- No consistent error strategy — each layer inventing its own mix of throw / return-null / silent-default

### 5. Code Health & DRY

- DRY violations — duplicated logic that should be a shared utility or hook, especially across feature boundaries
- SRP violations — functions/components doing too many unrelated things
- Overly defensive coding — checking for the same risks in multiple layers without a clear strategy
- Naming — misleading, ambiguous, or inconsistent names across a module boundary (e.g. the same concept called different things in different layers, or a name that no longer reflects what the code does)
- Dead code — unreachable paths, unused exports, or unused imports at module boundaries (not just individual variables)
- Type safety — pervasive use of `any`, missing return types on public API surfaces, unsafe casts

### 6. Toolchain & Developer Feedback Loops

- Installed-but-unused lint capability — a lint plugin whose installed version ships rules or presets the config doesn't enable (compare the plugin's actual rule list against the config; dry-run the candidate preset and report what it flags)
- Missing type-aware linting where it would catch real bug classes — especially unawaited/floating promises in async-heavy code (storage, sync, network layers)
- Documented invariants not machine-enforced — an architecture rule stated in CLAUDE.md/docs (layer purity, import direction, "X never imports Y") that no lint rule or CI check actually guards; propose the enforcing rule
- Missing dead-code and unused-dependency detection (e.g. knip) when unused exports are accumulating; missing coverage measurement when test gaps are a finding
- CI/local drift — checks that run locally but aren't gated in CI, or CI steps with no local equivalent
- Formatter: note presence/absence and whether adopting one actually fits this project. Consider the authorship model (a single-author or agent-written codebase with consistent deliberate style may be right to skip one) and the migration cost — evaluate the trade-off, don't reflexively recommend adding it
- Recommend against tools too: fast lint/format replacements that can't replicate existing custom rules, or pre-commit hooks that duplicate CI, are anti-recommendations worth stating

### 7. Dependencies & Library Fit

Evaluate in **both directions**, and say explicitly when the status quo is correct:

- **Custom code reimplementing an installed library's feature** — raw implementations sitting next to a dependency that does it correctly (e.g. hand-rolled millisecond date math beside a date library, manual filtering inside a component library that ships a scorer, a library's core feature explicitly disabled and replaced with a weaker inline version)
- **Library used outside its core use case** — a dependency whose reason-to-exist (SSR, framework integration, scale) doesn't apply to this project, where a small custom implementation would carry less weight; note honestly when it's harmless to keep
- **Missing library** — a hand-rolled subsystem where a standard, well-maintained library is clearly better (correctness-critical parsing, protocol handling, a11y-heavy widgets)
- **Deliberate custom code that is right** — when custom beats the obvious library (domain semantics the library can't express, coupling to an owned file format, library abandonment/known defects), state the keep-custom verdict and the reason instead of reflexively recommending the library
- Significantly outdated or abandoned dependencies; functionality duplicated across two libraries; heavyweight dependencies used for a small fraction of their surface (flag as "watch", not necessarily "replace")

### 8. Styling & UX

- Shadcn component available but bypassed in favour of a custom re-implementation
- Raw CSS / inline styles where Tailwind classes would suffice, or Tailwind used where plain CSS is clearly better
- UX anti-patterns: missing loading/error states, non-accessible interactive elements (no keyboard nav, missing ARIA)

### 9. Performance

- React anti-patterns: object/array literals in JSX props, missing `useMemo`/`useCallback`/`memo` at component boundaries (not fine-grained)
- Missing lazy-loading / code-splitting at route or feature boundaries
- N+1 or waterfall data fetching patterns

---

**Scoring guidance:** A finding that reveals a structural pattern affecting the whole codebase (e.g., "every feature imports from `lib/` internals instead of going through a public API") scores higher than a finding about a single misused hook. A toolchain finding that would _mechanically catch an entire class of issues_ (e.g. enabling an installed lint preset that flags 30 real problems, or a lint zone that enforces a documented architecture invariant) scores like the class it catches, not like a config tweak. Skip findings that are purely stylistic or affect a single isolated callsite — they belong in a lint rule, not a health report.
