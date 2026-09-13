# UI-Layer Health Survey

Survey the **UI layer** of this codebase for code health issues across the categories below.

Shared process, scoring, and reporting rules — model-tier ratings, the ranking
formula, category-verdict conventions, and how to report results — live in [the
shared survey conventions](./README.md). Read that first; this file states only
what's specific to this survey.

## Scope

**In scope:** React components and JSX, custom hooks, shadcn/ui usage, Tailwind and any raw CSS, routing/view composition, client-side UI state (loading/error/empty states, dialogs, toasts), accessibility, and render performance. The UI-relevant toolchain (React/JSX/a11y/Tailwind lint rules, component test setup) is also in scope.

**Out of scope:** domain logic, data models, parsing/serialization, storage/sync backends, and non-UI utilities — **except at the boundary**: domain logic embedded inside components/hooks, or UI concerns leaking into non-UI modules, are in-scope findings, and that boundary is a primary hunting ground. Do not report on the internals of non-UI modules themselves.

Start by identifying which directories constitute the UI layer and state that list in your scan plan.

## Process

Per [Running a survey](./README.md#running-a-survey): scan plan first, evaluate on merits, verify capability claims by inspection. That last one extends to component libraries — check what the installed shadcn/radix components actually ship before claiming a custom implementation duplicates one. One rule is specific to this survey:

**Verification extends to build-time tooling, not just linters.** Compilers and transforms (React Compiler/`babel-plugin-react-compiler`, SWC/Babel plugins, CSS transforms) make claims a lint run never checks. Where a source comment asserts build-time behaviour ("this shape makes the compiler bail out", "this is memoized"), reproduce it. This is often the highest-yield check in the survey, because a build-time regression is invisible to build, lint and tests alike.

The recipe, for this repo specifically — it took several dead ends to find, and a run that loses its budget to setup will skip the check entirely. Put the driver in the **repo root** (Node resolves `@babel/core` by walking up from the script, so one under a temp directory cannot see `node_modules`), and note that `reactCompilerPreset()` returns `{ preset, rolldown }` — Babel rejects the wrapper and wants `.preset`:

```js
import * as babel from '@babel/core'
import { reactCompilerPreset } from '@vitejs/plugin-react'
const { preset } = reactCompilerPreset({ target: '19' })   // matches vite.config.ts
const out = babel.transformSync(src, {
  filename, presets: [preset], parserOpts: { plugins: ['jsx', 'typescript'] },
  configFile: false, babelrc: false,
})
// memoized iff the output imports 'react/compiler-runtime' and calls _c(n)
```

Counting `_c(` per file turns this into a census over a whole directory rather than a two-case fixture — which is how a partially-memoized component library shows up at all. Clean up the driver afterwards.

## Budget

- Skim the full directory tree once so nothing is invisible, then confine close reading to the UI layer.
- Read closely: the app shell / root layout, the most-imported components and hooks (measure this — don't guess), the 15 largest component files, every file in the shared-components directory, and 2–3 representative components from every feature directory that renders UI.
- **Read the UI toolchain, not just the source:** Tailwind config, global CSS / theme tokens, the shadcn inventory (`components/ui/`) and its divergence from upstream, lint config for React/JSX/a11y/Tailwind rules, and the component-test setup. Inventory the UI dependencies (React ecosystem, radix/shadcn, styling, icons, animation, forms, a11y) and know where each is used — this feeds category 8.
- **Run the existing quality gates once** — build, lint, test — and report each gate's status in the coverage statement. Generate the gitignored types first, per [what this environment can and cannot do](./README.md#what-this-environment-can-and-cannot-do).
- **Audit the gates' own config, not just their exit codes.** A green gate says nothing about whether it is still aimed at the right files. Check every path in the lint, coverage and smoke-test configs against the filesystem: per-file coverage thresholds naming a moved file, exclusion globs whose stated rationale a grown file has outlived, route lists a new route doesn't automatically join. These fail *open* — Vitest accepts a threshold for a nonexistent path and exits 0 silently — so nothing surfaces them but this check.
- **Look at the running app at phone width, in every theme. This survey cannot be done from jsdom.** Categories 2 and 3 are largely unreachable without it: touch-target size, safe-area insets, hover-only affordances, focus after navigation and dark-mode gaps have no layout engine to fail against in the test suite. The consequence is visible in the PR history — the contrast and phone-layout defects of 2026-08/09 were all found by hand, by the user, after a UI survey had passed over the same files. `CLAUDE.md`'s "don't proactively drive the dev server" rule does not apply to a survey run, and this is the pass it exempts.

  Read the two CI gates first, so the pass is spent on what they cannot see: `e2e/contrast-sweep.spec.ts` is an enforced contrast floor across all nine themes, and `e2e/layout-smoke.spec.ts` pins shell geometry plus route coverage. A contrast finding has to clear that floor to be a finding at all. With no `preview_*` tooling, drive Chromium yourself — `@playwright/test` is a devDependency and `e2e/` is the worked example (`pnpm exec vite --port <unique> --strictPort`, then `import { chromium } from '@playwright/test'`, at 390×844 and 1440×900, setting the theme in an init script per palette). If even that is unavailable, say so and mark the affected categories **partially assessed**; an admitted gap beats an impression inferred from tokens.
- **Sample git history for co-change patterns** among components, hooks and style files — the evidence base for co-location findings. [Un-shallow the clone first](./README.md#running-a-survey).
- Sample the rest of the UI. Don't skip a UI directory without recording it. Non-UI directories may be skipped wholesale — record them as "out of scope", not "skipped".

## Output structure

**Reporting:** per the [shared reporting conventions](./README.md#reporting), including suggested improvements to this survey file itself.

1. **Health verdict** (~5 sentences) — the UI layer's overall health. Name the worst one or two areas (by directory or subsystem, not individual findings) and the single biggest structural theme running through the findings.
2. **Coverage statement** — which UI directories you examined closely, sampled, or excluded as out of scope, with reasons; roughly what fraction of the UI layer this rests on; anything you suspect but lacked budget to investigate, flagged "unverified".
3. **Category verdicts** — one line per category (1–8), per the [shared convention](./README.md#category-verdicts). Category 8's **keep-custom verdicts** ("this custom UI is right, and here's why") belong here under that category's line — they are conclusions, not defects, and must not consume a findings slot.
4. **Findings — top 10**, numbered, per [don't pad the list](./README.md#dont-pad-the-findings-list).

Findings carry the [shared fields](./README.md#finding-fields). This survey adds:

- **Category** — one or more of: `component-architecture` `layout` `dry` `srp` `dead-code` `types` `error-handling` `testing` `styling` `a11y` `ux` `performance` `security` `dependencies` `naming` `toolchain` `library-fit`
- **Impact** — 1–10 (10 = catastrophic/systemic; 5 = a UI pattern duplicated across ~4 components, or a missing error state on a primary flow; 1 = trivial/cosmetic)

**Fails silently here:** a broken interaction only reachable on touch, a focus trap that still renders but no longer traps, a token swap that looks right in light mode and wrong in dark, a memoization change that quietly stales the rendered state. Reserve plan mode + multi-PR for a structural change across the UI layer **or** a product decision ("extract a shared dialog" vs "restructure the feature's component boundary"). Hazard note example: "Sonnet 5 if the token names to use are listed in the task; else Opus 5." "Confirming" a fix means re-running build, lint, or the test suite.

**Breadth-in-files under-ranks concentrated findings — say so rather than inflating it.** A god component is by construction one file: the defect *is* that N repetitions of one concern live in the same place, so `(impact × breadth) ÷ effort` scores it below a one-line lint tweak spanning 100 files. Don't fix that by padding the breadth count. Report the honest count, and add one line under the summary table naming which findings the formula demotes, so the reader can re-sort on impact.

---

## Categories to scan — ranked by priority

Bullets are illustrations, not your search space — see [Running a survey](./README.md#running-a-survey).

### 1. Component Architecture & Boundaries _(highest weight)_

**Scope:** whether UI responsibilities live in the right components/hooks and the composition structure is sound. This category owns **component-level** concern sprawl; single-function SRP belongs in category 5.

- Domain logic embedded in components — parsing, date math, persistence calls or business rules inline in render code instead of in hooks or the domain layer
- God components — one component owning unrelated concerns (data fetching + layout + form state + side effects); heuristic: 300+ lines or 10+ pieces of state
- UI state in the wrong place — the global store used for local state or vice versa; derived state stored instead of computed; effect chains re-deriving what a selector should own
- Feature components reaching into another feature's component internals instead of its public surface
- **Two writers for one piece of view state.** The largest single defect cluster in the repo's recent history, and no category named it before 2026-09-13: a derived navigation value owned by more than one controller. The week topbar's label desyncing from the quick-nav month strip (#885), the agenda's own scroll position steering the quick-nav grid (#908), one swipe firing two browses (#913), a swipe preview coupled to route navigation (#901), a seeded scroll offset reverted outright for a drifting Today button and a broken cold start (#911 → #915) — nine PRs in a fortnight, all the same shape. The tells: a value held in `calendar/viewState.ts` *and* in a component's `useState`; an effect that writes the state its own dependency array reads; a gesture handler and a route loader that both set the visible date. Trace each navigation value to exactly one writer.

### 2. Styling System Consistency _(high weight)_

**Scope:** whether styling follows one coherent system (here: Tailwind + shadcn tokens) and where it fragments.

- Hardcoded colors/spacing/z-index bypassing the theme tokens (`#hex`, arbitrary `[...]` values) — grep for these and count them
- Repeated multi-class strings that should be a `cva` variant or shared component; conditional classes built by string concatenation where the project's `cn` helper exists
- Divergence inside `components/ui/` — shadcn primitives locally patched in ways that fork them from upstream with no recorded reason
- Raw CSS or inline `style={{...}}` where Tailwind would suffice, or the reverse: utility soup where a shared variant is warranted
- Dark-mode/theming gaps — components styled for one scheme only

### 3. UX States & Accessibility

**Scope:** whether the UI communicates state and is usable by everyone, including on mobile. This is a mobile-focused PWA, so responsive behavior, touch ergonomics and safe-area handling are primary hunting grounds, not edge cases.

- Missing loading/empty/error states on primary flows; actions with no pending or failure feedback after a rejected promise
- **Custom components that render a bare element** — an `onClick` on `<Badge>`, `<Card>`, or any wrapper returning a plain `span`/`div`. Grepping for `<div onClick>` misses these entirely, and so does `jsx-a11y`, which cannot see through component indirection unless told via `settings['jsx-a11y'].components`. Resolve each shared wrapper to the element it actually returns, then re-check every `onClick` on it — a codebase with zero raw clickable `div`s can still route all its interactions through one.
- Other non-accessible interactive elements: missing keyboard handling, focus not managed in dialogs/menus, missing labels on icon-only buttons
- Mobile/responsive gaps — layouts that break at phone widths, touch targets below ~44px, hover-only affordances, safe-area regressions, a desktop dialog where the drawer pattern (`vaul`) is used elsewhere for the same interaction
- Destructive actions without confirmation or undo; focus/scroll position lost across navigation or list updates; the same operation behaving differently on different screens

### 4. Security (UI-facing)

**Scope:** ways malicious or malformed input could compromise the rendered UI. State the threat model first: what user- or file-supplied content is rendered, and how.

- `dangerouslySetInnerHTML` or manual DOM injection of user/file-derived content without sanitization
- User-controlled URLs in `href`/`src` (`javascript:` schemes), unsafe `target="_blank"` without `rel`
- Untrusted content (markdown, frontmatter, wikilinks, file names) reaching rendering unescaped

### 5. Code Health & DRY (components and hooks)

**Scope:** local quality of UI code — duplication, cohesion, naming and type discipline at the component/hook/function level.

- Duplicated JSX blocks or hook logic that should be a shared component/hook
- One component doing several unrelated jobs (below category 1's module-level sprawl)
- Dead components, unused props, unused exports from UI modules
- `any`/unsafe casts in props and handlers; over-permissive prop types (`props: any`, `[key: string]: unknown`)
- The same UI concept named differently across components, or a component name that no longer matches what it renders

### 6. React Performance

**Scope:** render work done unnecessarily, too often, or at the wrong time.

React Compiler is enabled, so memoization claims need runtime render counts rather than code inspection — see `performance.md`'s Process section, which owns that rule. What remains inspectable here: store subscriptions without selectors (whole-store subscriptions re-rendering on every change), expensive computation in render, large lists without virtualization or with misused keys, missing lazy-loading at route or heavy-feature boundaries, and effects that loop on unstable dependencies.

### 7. UI Toolchain & Feedback Loops

**Scope:** whether tooling catches the UI mistakes this codebase actually makes, as early as possible.

- `eslint-plugin-react-hooks`, `jsx-a11y` or Tailwind plugins installed but not fully enabled — compare installed rule sets against the config, dry-run the missing ones, report what they actually flag
- Documented UI conventions (token usage, the `cn` helper, barrel imports) that no rule enforces — propose the enforcing rule
- Component behavior with no test harness at all, when UI regressions are a finding elsewhere
- Tailwind class sorting/formatting: evaluate whether adopting it fits; don't reflexively recommend it

### 8. UI Dependencies & Library Fit

**Scope:** whether each UI dependency earns its place, and whether custom UI should be a dependency — in both directions. Say explicitly when the status quo is correct.

- Custom widgets duplicating an installed shadcn/radix component (check the installed inventory, not memory) — dialogs, popovers, tooltips and menus are the usual offenders
- A hand-rolled a11y-heavy widget (combobox, date picker, drag-and-drop) where a maintained primitive is clearly safer
- UI libraries used far outside their core use case, or two libraries covering the same ground (two icon sets, two animation approaches)
- **Deliberate custom UI that is right** — state the keep-custom verdict and the reason under category 8's verdict line

---

**Scoring guidance:** A structural pattern across the UI ("every feature builds its own dialog instead of the shared one", "hardcoded colors bypass the theme in 30 files") scores higher than a single misused hook. A toolchain finding that mechanically catches an entire class of UI issues scores like the class it catches. Skip findings that are purely stylistic at a single callsite — they belong in a lint rule, not a health report.
