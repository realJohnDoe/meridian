# UI-Layer Health Survey

Survey the **UI layer** of this codebase for code health issues across the categories below.

## Scope

**In scope:** React components and JSX, custom hooks, shadcn/ui usage, Tailwind and any raw CSS, routing/view composition, client-side UI state (loading/error/empty states, dialogs, toasts), accessibility, and render performance. The UI-relevant toolchain (React/JSX/a11y/Tailwind lint rules, component test setup) is also in scope.

**Out of scope:** domain logic, data models, parsing/serialization, storage/sync backends, and non-UI utilities — **except at the boundary**: domain logic embedded inside components/hooks, or UI concerns leaking into non-UI modules, are in-scope findings (that boundary is a primary hunting ground). Do not report on the internals of non-UI modules themselves.

Start by identifying which directories constitute the UI layer and state that list in your scan plan.

## Process

- **Scan first, write second.** State your scan plan before you start, complete the full scan, and only then write the report. In the scan plan, for each category, state what you'll look for beyond the listed examples — the bullets are illustrations, not your search space. Do not draft the verdict early and select findings to confirm it.
- Evaluate the code on its merits. Treat claims in CLAUDE.md, READMEs, or architecture docs (e.g. "this exception is deliberate") as hypotheses to verify against the code, not as settled exceptions — if a documented rationale no longer holds, that is a finding.
- **Verify capability claims by inspection, not memory.** For toolchain findings, check the _installed_ version of a plugin/library (its actual rule set, exports, or API) against what the config enables — do not assume from the version number. Where cheap, verify by dry-run: e.g. run the linter with a candidate preset via a temporary config and report the real finding count and distribution (clean up temp files afterwards). The same applies to component libraries: check what the installed shadcn/radix components actually ship before claiming a custom implementation duplicates one.

## Known suspects (optional)

If prior work on this repo has raised specific suspicions about the UI, list them here as **hypotheses to verify or refute**. The report must state a verdict on each (confirmed / refuted / couldn't verify); a refutation is as valid an outcome as a confirmation.

- _(none listed)_

## Budget

- Skim the full directory tree once so nothing is invisible, then confine close reading to the UI layer.
- Read closely: the app shell / root layout, the most-imported components and hooks (measure this — don't guess), the 15 largest component files, every file in the shared-components directory, and at least 2–3 representative components from every feature directory that renders UI.
- **Read the UI toolchain, not just the source:** Tailwind config, global CSS / theme tokens, the shadcn component inventory (`components/ui/` or equivalent) and its divergence from upstream, lint config for React/JSX/a11y/Tailwind rules, and the component-test setup (or its absence). From `package.json`, inventory the **UI-related** dependencies (React ecosystem, radix/shadcn, styling, icons, animation, forms, a11y) and know where each is used — this feeds the Library Fit category.
- **Sample git history for co-change patterns** among components, hooks, and style files (e.g. `git log --name-only` over recent commits) — this is the evidence base for co-location findings; don't assert "these files change together" from intuition.
- Sample the rest of the UI. Do not skip a UI directory entirely without recording it in the coverage statement. Non-UI directories may be skipped wholesale — record them as "out of scope" rather than "skipped."

## Output structure

### 1. Health verdict (~5 sentences)

A plain-language summary of the UI layer's overall health. Name the **worst one or two areas** (by directory or subsystem — not individual findings) and the **single biggest structural theme** running through the findings. This is the headline answer; the list below is the supporting evidence.

### 2. Coverage statement

- Which UI directories/files you examined closely, which you only sampled, and which you excluded as out of scope — with the reason.
- Roughly what fraction of the UI layer this report is based on.
- Any area you suspect has issues but did not have budget to investigate — flag it as "unverified."

### 3. Findings

For each finding, output:

- **Title** — short label
- **Category** — one or more tags from: `component-architecture` `layout` `dry` `srp` `dead-code` `types` `error-handling` `testing` `styling` `a11y` `ux` `performance` `security` `dependencies` `naming` `toolchain` `library-fit`
- **Impact** — 1–10 (10 = catastrophic/systemic; 5 = e.g. a UI pattern duplicated across ~4 components, or a missing error state on a primary user flow; 1 = trivial/cosmetic)
- **Breadth** — number of **files** affected. Counts must come from an actual search (grep/glob), and you should be able to name the search you ran; if you estimated instead, write "est." next to the number.
- **Fix effort** — S / M / L (S = localized edit; M = touches a few components or needs a small refactor; L = structural change across the UI layer)
- **Evidence** — at least one file path plus a short **verbatim code quote** from that file (line number optional). The quote must be copy-pasted, not paraphrased — I will spot-check by grepping for it. For toolchain findings, the evidence may be a config quote plus a dry-run result.
- **Problem** — one sentence: what is wrong and why it matters
- **Fix** — one sentence: what the concrete fix looks like

Rank findings by a rough `(impact × breadth) ÷ effort` intuition — but report the three fields separately so the reader can re-sort.

**Strongly prefer systemic and structural issues over isolated, line-level ones.** A pattern repeated across 10 components beats one misused hook. Cite real code — no generic observations.

List the **top 10 findings**. Include all findings that make the top 10 regardless of their impact score. Do not pad to reach 10 — if fewer than 10 clear issues exist, stop there.

---

## Categories to scan — ranked by priority

The category ranking is a tiebreaker, not a filter. A serious finding in any category always outranks a minor finding in a higher-priority category — never omit a high-impact issue because its category ranks lower.

**The bullets under each category are illustrative examples, not the category's boundary.** Report any finding that fits the scope line, including issue types not listed.

### 1. Component Architecture & Boundaries _(highest weight)_

**Scope:** whether UI responsibilities live in the right components/hooks and the composition structure is sound. This category owns **component/module-level** concern sprawl; single-function SRP belongs in category 5.

Examples (not exhaustive):

- Domain logic embedded in components — parsing, date math, persistence calls, or business rules inline in JSX/render code instead of in hooks or the domain layer
- God components — a single component owning unrelated concerns (data fetching + layout + form state + side effects); heuristic: 300+ lines or 10+ pieces of state
- Prop drilling through 3+ layers where context, composition (`children`), or the store would fit
- UI state managed in the wrong place — global store used for local component state, or vice versa; derived state stored instead of computed
- Missing component API boundaries — feature components reaching into another feature's component internals instead of its public surface
- Side effects in render paths, effect chains that re-derive what a `useMemo`/selector should own

### 2. Styling System Consistency _(high weight)_

**Scope:** whether styling follows one coherent system (here: Tailwind + shadcn tokens) and where it fragments.

Examples (not exhaustive):

- Raw CSS files or inline `style={{...}}` where Tailwind utilities would suffice — or the reverse: utility-class soup where a shared variant/component is warranted
- Hardcoded colors/spacing/z-index bypassing the theme tokens (e.g. `#hex` or arbitrary values `[...]` instead of design-token classes) — grep for these, count them
- Repeated multi-class Tailwind strings that should be a `cva` variant, shared component, or `@apply`-free abstraction
- Divergence inside `components/ui/` — shadcn primitives locally patched in ways that fork them from upstream without a recorded reason
- Dark-mode/theming gaps — components styled for one scheme only
- Conditional class logic built by string concatenation where the project's `cn`/`clsx` helper exists

### 3. UX States & Accessibility

**Scope:** whether the UI communicates state and is usable by everyone.

Examples (not exhaustive):

- Missing loading/empty/error states on primary flows; actions with no pending or failure feedback (silent failures after a rejected promise)
- Non-accessible interactive elements — clickable `div`s, missing keyboard handling, focus not managed in dialogs/menus, missing labels/ARIA on icon-only buttons
- Destructive actions without confirmation or undo
- Focus/scroll position lost across navigation or list updates
- Inconsistent interaction patterns for the same operation in different screens

### 4. Security (UI-facing)

**Scope:** ways malicious or malformed input could compromise the rendered UI or its users. State the threat model first: what user- or file-supplied content is rendered, and how.

Examples (not exhaustive):

- `dangerouslySetInnerHTML` or manual DOM injection of user/file-derived content without sanitization
- User-controlled URLs in `href`/`src` (`javascript:` schemes), unsafe `target="_blank"` without `rel`
- Untrusted content (markdown, frontmatter, wikilinks, file names) flowing into rendering without escaping

### 5. Code Health & DRY (components and hooks)

**Scope:** local quality of UI code — duplication, cohesion, naming, and type discipline at the component/hook/function level.

Examples (not exhaustive):

- Duplicated JSX blocks or hook logic across components that should be a shared component/hook
- One component doing several unrelated jobs (below the module-level sprawl of category 1)
- Dead components, unused props, unused exports from UI modules
- `any`/unsafe casts in props and event handlers; untyped or over-permissive prop interfaces (`props: any`, `[key: string]: unknown`)
- Naming — the same UI concept named differently across components, or component names that no longer match what they render

### 6. React Performance

**Scope:** render work done unnecessarily, too often, or at the wrong time.

Examples (not exhaustive):

- Store subscriptions without selectors (whole-store subscriptions re-rendering on every change)
- Unstable object/array/function literals passed to memoized children or context providers
- Expensive computation in render without `useMemo`; large lists without virtualization or keys misuse
- Missing lazy-loading/code-splitting at route or heavy-feature boundaries (editor, calendar)
- Effects that loop or re-fire due to unstable dependencies

### 7. UI Toolchain & Feedback Loops

**Scope:** whether tooling catches the UI mistakes this codebase actually makes, as early as possible.

Examples (not exhaustive):

- `eslint-plugin-react-hooks`, `jsx-a11y`, or Tailwind lint plugins installed but not (fully) enabled — compare installed rule sets against the config, dry-run missing presets, and report what they actually flag
- Component behavior with no test harness at all (no RTL/vitest setup for UI) when UI regressions are a finding elsewhere
- Documented UI conventions (token usage, `cn` helper, barrel imports) not machine-enforced — propose the enforcing rule
- Class-sorting/formatting for Tailwind: evaluate whether adopting it fits, don't reflexively recommend it

### 8. UI Dependencies & Library Fit

**Scope:** whether each UI dependency earns its place, and whether custom UI code should be a dependency — in both directions. Say explicitly when the status quo is correct.

Examples (not exhaustive):

- Custom widgets duplicating an installed shadcn/radix component (check the installed inventory, not memory) — dialogs, popovers, tooltips, menus are the usual offenders
- A hand-rolled a11y-heavy widget (combobox, date picker, drag-and-drop) where a maintained primitive is clearly safer
- UI libraries used far outside their core use case, or two libraries covering the same ground (e.g. two icon sets, two animation approaches)
- **Deliberate custom UI that is right** — when custom beats the library (domain-specific rendering, editor integration), state the keep-custom verdict and the reason

---

**Scoring guidance:** A finding that reveals a structural pattern across the UI (e.g. "every feature builds its own dialog instead of the shared one", "hardcoded colors bypass the theme in 30 files") scores higher than a single misused hook. A toolchain finding that would _mechanically catch an entire class of UI issues_ scores like the class it catches. Skip findings that are purely stylistic at a single callsite — they belong in a lint rule, not a health report.
