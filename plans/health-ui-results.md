# UI-Layer Health Survey — results

Run against `claude/surveys-ui-gu2vpe` at `adcc69d`, per
[`plans/surveys/health-ui.md`](./surveys/health-ui.md) and the
[shared conventions](./surveys/README.md).

The survey file itself was updated in a separate commit on this branch — see
"Survey file changes" at the bottom for what and why.

## 1. Health verdict

This is a healthy UI layer, and unusually well-instrumented: three gates
(build, lint, 3395 + 41 tests) pass on a clean install, the module boundaries
are machine-enforced rather than documented, every hand-written
`eslint-disable` carries a reason, and there is not a single whole-store
subscription, raw clickable `div`, `dangerouslySetInnerHTML`, or unreasoned
`any` in the shipped code. The worst area by some distance is
**`src/routes/_app.tsx`**, whose `AppMain` is a 481-line component that
re-derives the same day/week/month/list/agenda discriminant in nine separate
branch chains — in three different orderings — while being excluded from the
coverage report under a rationale ("route registration and little else") that
stopped being true for it some time ago. The second-weakest area is the
**build-time and geometry tooling**: the guards this repo relies on to catch
what lint and tests cannot see are each about half-installed — the React
Compiler bail-out rule matches only one of the three function shapes it needs
to, `scripts/layout-smoke.mjs` covers 5 of 14 routes, and one of
`vitest.config.ts`'s 46 per-file coverage floors points at a path that no
longer exists and is silently inert.

The single biggest structural theme is **guards that are narrower than the
invariant they were written to protect**. Every finding below except #1
is an instance: a correct rule with a selector that misses two-thirds of the
shapes, a correct smoke test enumerating a third of its routes, a correct
exclusion glob that has outgrown its own justification, a correct coverage
floor aimed at a moved file. None of them fail loudly — that is precisely the
class of thing this codebase otherwise defends against very well, which is
what makes the gaps worth closing rather than a sign of neglect.

## 2. Coverage statement

**Read closely:** `src/routes/` (all 26 non-test files, `_app.tsx` and
`__root.tsx` line by line), `src/components/` (all 11 non-test files),
`src/components/primitives/` (all 9), `src/components/ui/` (inventory of all
22 plus close reads of `button`, `badge`, `card`, `separator`, `tooltip`,
`sidebar`, `drawer`, `calendar`), `src/hooks/` (all 13), `src/lib/` (all 12),
`src/index.css` (all 1048 lines, plus a scripted token-parity check across all
9 themes), `eslint.config.js`, `vite.config.ts`, `vitest.config.ts`,
`components.json`, `knip.json`, `scripts/layout-smoke.mjs`, and the UI
dependency inventory from `package.json`.

**Sampled:** `src/calendar/` (55 non-test files — read `DayView`, `WeekView`,
`MonthView`, `MiniMonth`, `OccurrencePill`, `AgendaLoadEarlierRow`,
`AgendaView`, `viewState`; the rest skimmed for structure and via the scripted
censuses below), `src/editor/` + `dialogs/` + `cm/` (read `EntryEditor`,
`EntryViewOnly`, `urlSafety`, `TimeWheels`, `markdownFormatting`, the dialog
inventory; `useEntryEditor` skimmed), `src/settings/` (skimmed;
`VaultSettings` and `AddVaultWizard` read in part), `src/search/`,
`src/onboarding/` (skimmed).

**Whole-file reads were supplemented by scripted censuses over the full UI
layer**, so no file was invisible: a state/effect/line-count census over every
`.ts(x)`; an `onClick`-owner resolution over every `.tsx`; hex/arbitrary-value/
inline-`style` greps; import-frequency counts; a per-file React Compiler
memoization census over all 22 `components/ui/` files; and two ESLint dry-runs
against temporary configs (all temp files removed).

**Excluded as out of scope:** `src/model/`, `src/storage/`, `src/fileIO.ts`,
`src/wikilinks.ts`, `src/types.ts`, `worker/` — domain logic, storage backends
and the OAuth worker. Checked only at the boundary (no domain logic found
embedded in components; no UI concerns found leaking into `model/`, which
`eslint.config.js` enforces anyway). `src/debug/` was read but is
developer-only and **verified absent from the production bundle** (nothing
outside `src/debug/` imports it; `dist/assets/*.js` contains no reference), so
its 837-line, 19-`useState` debugger is deliberately not reported.

**Fraction:** roughly 60–65% of the UI layer read directly, with scripted
coverage of 100%.

**Unverified — flag for a later run:**
- `src/settings/VaultSettings.tsx` (431 lines, 7 `useState`, 5 `useStore`) and
  `AddVaultWizard.tsx` (254 lines, 8 `useState`) were skimmed, not read
  through. Both are form-heavy screens with real error paths; I did not trace
  their loading/error states end to end.
- `src/editor/useEntryEditor.ts` (396 lines, 5 `useState` / 4 `useEffect` /
  6 `useRef`) is the editor's state hub and the most likely remaining home for
  an effect-chain finding. Its coverage floor (68/55/55/70) is the loosest
  non-global one in `vitest.config.ts`, which is itself a hint.

## 3. Category verdicts

1. **Component Architecture & Boundaries** — **clean.** 0 whole-store
   subscriptions, 0 selector-returns-literal subscriptions, module boundaries
   enforced by `no-restricted-paths`, and `DayView`/`WeekView` are thin shells
   over a shared `useCarousel` seam.
2. **Styling System Consistency** — **clean.** One CSS file; 0 hardcoded hex
   outside `src/debug/` and one deliberate `PARSE_PROBE`; 14 arbitrary
   Tailwind values, every one a genuine computed length (`calc`, `env()`,
   `var()`); 41 inline `style={{}}`, all virtualizer/timeline geometry; `cn`
   used throughout with no string-concatenated class logic. A scripted
   token-parity check across all 9 themes found **full parity** — the
   apparent gaps are geometry tokens deliberately global on `:root`, derived
   tokens (`--done-overlay`, `--search-bar-bg`, `--event-border` are
   `color-mix()` over per-theme tokens, so they re-resolve per theme), and a
   shared light-themes-only shadow block.
3. **UX States & Accessibility** — **clean.** Every `onClick` in the codebase
   was resolved to the DOM element its owner actually renders: all 135 land on
   a real `<button>` or a Radix control. `SurfaceButton`/`IconButton` →
   `<button>`; `OccurrencePill` → `SurfaceButton` when clickable and a plain
   `div` when not; `PropChip`/`AddChip`/`AgendaLoadEarlierRow` → `<button>`.
   The one `div` with an `onClick` in shipped code (`TimeWheels.tsx:248`)
   carries `role="listbox"`, `aria-label`, `tabIndex={0}` and `onKeyDown`.
   `jsx-a11y`'s `components` setting already teaches it to see through
   `Badge`/`Card`/`DimmableCard`. Safe-area insets are handled in all three
   shells and the sidebar; `AppErrorFallback` is wired as the router's
   `defaultErrorComponent`; deletes have an undo toast.
4. **Security (UI-facing)** — findings: #8. Threat model: `.ics` subscription
   feeds, GitHub repo contents, and local Markdown files supply frontmatter
   (`url`, `location`, `organizer`, `attendees`), body Markdown and wikilinks,
   all rendered as React children. No `dangerouslySetInnerHTML`, no
   `innerHTML`/`insertAdjacentHTML`, no `document.write`, no user-controlled
   `src`. The two URL sinks (`EntryViewOnly.tsx:102`, `markdownFormatting.ts:66`)
   both gate on `isSafeUrl` before the element ever carries the href — the
   right shape. #8 is that the gate has no tests, not that it is wrong.
5. **Code Health & DRY** — **clean.** `knip` reports no unused files, exports
   or dependencies; zero `any`/`@ts-expect-error` outside `routeTree.gen.ts`;
   all 16 hand-written `eslint-disable`s carry a written justification (the
   17th is the blanket directive in the generated `routeTree.gen.ts`, which
   ESLint ignores anyway).
6. **React Performance** — **clean.** Route-level code splitting is on
   (`autoCodeSplitting`, editor in its own 716K chunk); all four list surfaces
   are virtualized; `memo()` decisions are deliberate and documented, including
   the two documented *non*-memo cases.
7. **UI Toolchain & Feedback Loops** — **clean.** The enabled rule set is
   genuinely strong (full `jsx-a11y` recommended, `react-hooks`
   `recommended-latest` including the compiler diagnostics,
   `@eslint-react` `recommended-type-checked` plus 15 individually-raised
   rules, full `@typescript-eslint` type-checked, `import-x` boundary zones
   derived from the filesystem, `dependency-cruiser` for cycles).
8. **UI Dependencies & Library Fit** — **clean**, with three keep-custom
   verdicts. Every UI dependency is used and `knip` confirms none are
   unreferenced. **Keep-custom verdicts:**
   - **`MiniMonth` (383 lines) alongside `react-day-picker`** is correct, and
     already documented at `MiniMonth.tsx:39–45`: the quick-nav grid mounts
     three panes at once and is swiped continuously, and profiling traced a
     freeze to react-day-picker's per-cell formatting/modifier machinery. The
     library is retained for `DatePickerDialog`, where its range modes, roving
     tabindex and ARIA grid semantics are the right tool. Two month grids, two
     genuinely different jobs.
   - **`IconButton` over `Button size="icon"`** is correct: it decouples the
     44px hit area from the visual size via a `::before` pseudo-element, which
     no shadcn/radix primitive offers, and it makes `label` required so an
     icon-only button cannot ship unnamed.
   - **`CollapseRow`'s pure-CSS `1fr → 0fr` fold** is correct and should not be
     replaced by an animation library: its doc comment records two regressions
     (#843, #850) from the measure-and-animate approach a library would need,
     and the grid-row technique needs no measurement at all.
   - `vaul`, `cmdk`, `embla-carousel-react`, `next-themes`, `sonner`,
     `tw-animate-css` are each used exactly once, at their core use case. One
     icon set (`lucide-react`), one animation approach, one class utility
     (`cn` = `clsx` + `tailwind-merge`).

## 4. Findings

**Summary table** — `Rank` is `(impact × breadth) ÷ effort` per the
[shared formula](./surveys/README.md#ranking-findings); `#N` is stable
identity, not order.

| # | Rank | Title | Categories | Impact | Breadth | Recommended model | Score |
|---|------|-------|-----------|--------|---------|-------------------|-------|
| #8 | 5 | `isSafeUrl` — the only XSS gate — has no tests | `security` `testing` | 4 | 1 | **Haiku 4.5** | 4 |

---

### #8 — `isSafeUrl`, the app's only XSS gate, has no tests

- **Category** — `security` `testing`
- **Impact** — 4
- **Breadth** — 1 file (`src/editor/urlSafety.ts`), 2 call sites. Search:
  `grep -rn 'isSafeUrl' src/` → definition plus `EntryViewOnly.tsx:102` and
  `cm/markdownFormatting.ts:66`; `ls src/editor/urlSafety*` → no test file.
- **Recommended model** — **Haiku 4.5.** Writing table-driven tests for a
  pure single-expression predicate is fully specified once the cases are
  listed, and a wrong test fails loudly. The one hazard — that this is an
  allowlist and must stay one — is named below.
- **Evidence** — `src/editor/urlSafety.ts:6`:
  ```
  export function isSafeUrl(url: string): boolean {
    return /^(https?|mailto):/i.test(url)
  }
  ```
  and its consumer at `src/editor/EntryViewOnly.tsx:102`:
  ```
            {url && (isSafeUrl(url) ? (
  ```
- **Problem** — This one regex is the entire barrier between an `.ics`
  subscription's or a synced repo's `url:` frontmatter and a rendered
  `<a href>`; the file's own comment notes an `<a href>` fires on middle-click
  and context-menu "open in new tab", so the element must never carry an
  unsafe href at all. In a repo with 3395 tests and per-file coverage floors
  on iCal date parsing and chevron components, the security predicate is the
  thing with no test — so a future "let's also allow `tel:` and relative
  paths" refactor has nothing to stop it from admitting `javascript:`.
- **Fix** — Add `src/editor/urlSafety.test.ts` covering the allow and deny
  sets below, and give the file a per-file coverage floor.

**Task context**

- **The enumerated cases.** Must return `true`: `https://x.test/a`,
  `http://x.test`, `HTTPS://X.TEST` (the regex is `i`-flagged),
  `mailto:a@b.test`. Must return `false`: `javascript:alert(1)`,
  `JavaScript:alert(1)`, `data:text/html,<script>`, `vbscript:msgbox`,
  `file:///etc/passwd`, `tel:+1`, `//evil.test` (protocol-relative),
  `/relative/path`, `` (empty), and — the one most likely to regress —
  `\n javascript:alert(1)` and ` javascript:alert(1)`, which are rejected only
  because the pattern is anchored with `^`.
- **The trap, located.** The predicate is an **allowlist anchored at `^`**,
  which is why leading-whitespace and control-character tricks fail safe. Any
  future edit that relaxes the anchor, drops the `^`, or switches to a
  denylist of bad schemes inverts that property. Write at least one test whose
  name says so, so the intent survives the refactor that breaks it.
- **Both call sites already do the right thing** and should not change:
  `EntryViewOnly.tsx:102–:111` renders a plain `<span>` (not a dead link) when
  the check fails, and `markdownFormatting.ts:66` gates `window.open`. The fix
  is tests only — do not touch the predicate.
- **Precedent for the floor.** `vitest.config.ts` already floors comparably
  small pure modules (`src/storage/conflictError.ts` at 90/85/95/95,
  `src/calendar/ContinuationChevron.tsx` at 92/90/95/92). A 100/100/100/100
  floor is achievable here — the function has one expression.
- **Verify after:** `pnpm run test`, and confirm the suite fails if you
  temporarily replace the pattern with `/(https?|mailto):/i` (unanchored).

---

## Survey file changes

`plans/surveys/health-ui.md` was updated in its own commit on this branch,
separate from this results file. Three process learnings from the run, none of
them findings about the product:

1. **The ranking formula's breadth term systematically under-ranks god
   components.** A 481-line component whose problem is nine repetitions of one
   branch is, by construction, one file — so `(impact × breadth) ÷ effort`
   ranks the most structurally important finding in this report last, below a
   one-line lint-selector tweak. The survey already says to prefer structural
   findings; the scoring rule pulls the other way, and the two should not
   contradict each other silently.
2. **The build-time-tooling check needs its recipe recorded.** The survey
   correctly calls this the highest-yield check, and it was — but getting a
   fixture through this repo's preset took several dead ends
   (`reactCompilerPreset()` returns `{ preset, rolldown }`, so Babel rejects
   the object; the driver script must sit in the repo root for Node to resolve
   `@babel/core`). A run that budgets 20 minutes for this check and loses them
   to setup will skip it.
3. **"Run the existing quality gates once" should include auditing the gates'
   own config for stale paths.** Findings #6 and #7 were both found by
   checking config path keys against the filesystem, not by running anything —
   a green gate says nothing about whether it is still pointed at the right
   files.
