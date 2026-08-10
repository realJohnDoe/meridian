import fs from 'node:fs'
import path from 'node:path'
import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importXPlugin from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import reactPlugin from '@eslint-react/eslint-plugin'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'

// A module is any src/ directory with its own index.ts(x) — its internals
// are private to its own subtree, reachable from outside only through that
// barrel. Derived from the filesystem (not hand-maintained) so the boundary
// rule below can never drift from the actual tree: a directory becomes a
// protected module the moment it grows a barrel, with no config edit.
function findModules(dir, base = '') {
  const modules = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('__')) continue
    const rel = base ? `${base}/${entry.name}` : entry.name
    const full = path.join(dir, entry.name)
    if (fs.existsSync(path.join(full, 'index.ts')) || fs.existsSync(path.join(full, 'index.tsx'))) {
      modules.push(rel)
    }
    modules.push(...findModules(full, rel))
  }
  return modules
}

const MODULES = findModules(path.resolve(import.meta.dirname, 'src')).sort()

// True when `a` is nested inside `b`'s own directory tree (or vice versa).
// Used to keep a nested module (e.g. a hypothetical editor/cm) out of its own
// ancestor's zone target: files physically inside a module's tree are that
// module's own implementation, not an outside consumer, so they may still
// reach the ancestor's local siblings directly. The ancestor itself stays in
// the nested module's target list, so reaching the nested module's internals
// from anywhere else — including from its own ancestor — still requires that
// nested module's barrel. No directory today has this shape; this only
// matters the day one does.
const nested = (a, b) => a.startsWith(`${b}/`) || b.startsWith(`${a}/`)

// react-hooks 'recommended-latest' includes the React Compiler's diagnostics
// (refs, set-state-in-effect, purity, immutability, …) alongside the two
// classic rules, at the preset's own severities: 'error' for everything
// actionable, 'warn' for exhaustive-deps, incompatible-library, and
// unsupported-syntax — rules that flag real but sometimes unfixable
// situations (e.g. a third-party hook whose API can't be memoized safely)
// rather than bugs to fix.
const reactHooksRules = reactHooksPlugin.configs['recommended-latest'].rules

// The flat preset is [languageOptions/plugins block, base-JS-rules block,
// type-checked-rules block] — the middle block explicitly turns off the base
// JS rules a @typescript-eslint equivalent replaces (e.g. `no-redeclare` off
// in favor of `@typescript-eslint/no-redeclare`), so spreading both rule
// blocks is safe and doesn't double-fire. Our own rule entries below (spread
// after) override the preset's defaults where we need non-default options.
const tsRecommendedTypeCheckedRules = {
  ...tsPlugin.configs['flat/recommended-type-checked'][1].rules,
  ...tsPlugin.configs['flat/recommended-type-checked'][2].rules,
}

export default [
  // Auto-generated files — skip entirely
  { ignores: ['src/routeTree.gen.ts'] },

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksPlugin,
      '@eslint-react': reactPlugin,
      'import-x': importXPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: './tsconfig.app.json' }),
      ],
    },
    rules: {
      // ── jsx-a11y ─────────────────────────────────────────────────────────────
      ...jsxA11yPlugin.flatConfigs.recommended.rules,
      // Radix primitives (Checkbox, etc.) render as a styled <button> rather
      // than a native form control, so label-has-associated-control's default
      // nested-control detection can't see them — teach it the wrapper name.
      // Input forwards straight to <input> but is a custom component so the
      // rule needs the same hint.
      'jsx-a11y/label-has-associated-control': [
        'error',
        { controlComponents: ['Checkbox', 'Input'], depth: 3 },
      ],

      // ── React hooks ──────────────────────────────────────────────────────────
      ...reactHooksRules,

      // ── @eslint-react ────────────────────────────────────────────────────────
      // Full recommended-type-checked rule set. Individual entries below
      // override its defaults (mostly 'warn') where we want 'error', and turn
      // off the handful of rules that duplicate a react-hooks equivalent
      // above (exhaustive-deps, set-state-in-effect, static-components,
      // use-state) so a single violation doesn't need two disable comments
      // under two different rule ids.
      ...reactPlugin.configs['recommended-type-checked'].rules,
      '@eslint-react/exhaustive-deps': 'off',
      '@eslint-react/set-state-in-effect': 'off',
      '@eslint-react/static-components': 'off',
      '@eslint-react/use-state': 'off',
      // Impure render (e.g. `new Date()` called directly in a component body)
      // breaks React Compiler's memoization assumptions. Matches the 'error'
      // severity already used for react-hooks/purity above; the two catches
      // this rule found on enabling it have been fixed, so this starts clean.
      '@eslint-react/purity': 'error',
      // Type-aware: catches {count && <X/>} rendering a stray 0/NaN/'' string.
      '@eslint-react/no-leaked-conditional-rendering': 'error',
      // Re-render churn: inline object/array literals passed as context values
      // or default props defeat consumer memoization on every render.
      '@eslint-react/no-unstable-context-value': 'error',
      '@eslint-react/no-unstable-default-props': 'error',
      // Array index as key breaks reconciliation identity when items are
      // reordered/inserted/removed.
      '@eslint-react/no-array-index-key': 'error',
      // Leaked timers/listeners: a setTimeout/setInterval/addEventListener
      // started in an effect (or elsewhere) must be cleaned up, or it keeps
      // firing against an unmounted component.
      '@eslint-react/web-api-no-leaked-timeout': 'error',
      '@eslint-react/web-api-no-leaked-interval': 'error',
      '@eslint-react/web-api-no-leaked-event-listener': 'error',
      '@eslint-react/web-api-no-leaked-resize-observer': 'error',
      '@eslint-react/web-api-no-leaked-intersection-observer': 'error',
      // Defining a component inside another component's render body creates
      // a new function identity every render, forcing a full remount of the
      // child (and losing its state) instead of a normal re-render.
      '@eslint-react/no-nested-component-definitions': 'error',
      // React 19 modernization: ref is a regular prop now, so forwardRef,
      // useContext, and <Context.Provider> are all obsolete. shadcn's own
      // upstream templates have already dropped forwardRef in favor of
      // ref-as-prop, so there's no vendor-legacy reason to keep it here either.
      '@eslint-react/no-forward-ref': 'error',
      '@eslint-react/no-use-context': 'error',
      '@eslint-react/no-context-provider': 'error',

      // ── TypeScript ───────────────────────────────────────────────────────────
      // Full type-checked rule set (await-thenable, no-unsafe-*,
      // no-explicit-any, restrict-template-expressions, unbound-method, …).
      // Individual entries below override its defaults where we need
      // non-default options.
      ...tsRecommendedTypeCheckedRules,

      // strict-type-checked adds 27 rules beyond recommended-type-checked; a
      // dry run of the full tier found two (no-non-null-assertion,
      // no-confusing-void-expression) that are noise for this codebase's
      // idioms, so only these three are enabled individually rather than
      // pulling in the whole preset.
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        // `while (true) { ... break ... }` is a deliberate idiom (storage/sync.ts's
        // retry-after-refresh loop) — not a redundant check to fix.
        { allowConstantLoopConditions: true },
      ],
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',

      // Enforce `import type` for type-only imports (auto-fixable)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Catch unused variables; _ prefix opts out
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `attributes: false` because async JSX event handlers (onClick={async
      // () => …}) are an idiomatic, harmless React pattern — React ignores
      // the returned promise. Other misuse (e.g. an async function used
      // where a plain boolean/void callback is required outside JSX) still
      // gets flagged.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // ── Import boundaries (barrel enforcement) ───────────────────────────────
      // Every module (a src/ directory with its own index.ts — see MODULES
      // above) is private to its own subtree; the only way in from outside is
      // its barrel. no-restricted-paths is the single expression of that
      // invariant: one zone per module, and each zone's target list is BOTH
      // every other module AND root-level src/*.{ts,tsx} files, so a root file
      // reaching into a module's internals is caught the same way a sibling
      // module reaching in is. (Root files still need module barrels too —
      // "root resident" per CLAUDE.md means cross-cutting, not privileged.)
      //
      // no-internal-modules is narrowed to what no-restricted-paths can't
      // express: deep imports into node_modules packages. All first-party
      // '@/**' imports are exempted here since the zones below now own that.
      'import-x/no-internal-modules': [
        'error',
        { allow: ['@/**', 'react-dom/client', '@testing-library/jest-dom/vitest'] },
      ],

      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            ...MODULES.map(protected_ => ({
              target: [
                './src/*.{ts,tsx}',
                ...MODULES.filter(m => m !== protected_ && !nested(m, protected_)).map(m => `./src/${m}`),
              ],
              from: `./src/${protected_}`,
              // components/ui/ (shadcn registry) and components/primitives/ (ours) are both
              // primitive layers — always allowed as deep imports.
              except: protected_ === 'components'
                ? ['./index.ts', './index.tsx', './ui', './primitives']
                : ['./index.ts', './index.tsx'],
              message: `Import from @/${protected_} barrel (index.ts), not from its internals.`,
            })),
            // UI components must not import from @/storage at all (barrel or internals).
            // Use vaultActions.ts for vault-management commands instead.
            {
              target: ['./src/components', './src/calendar', './src/editor', './src/search', './src/onboarding'],
              from: './src/storage',
              message: 'UI components must not import from @/storage. Use @/vaultActions for vault commands.',
            },
          ],
        },
      ],
    },
  },

  // worker/ is a standalone Cloudflare Worker package (its own tsconfig, no
  // React/DOM) that holds the OAuth token exchange — the most security-
  // sensitive code in the repo, since it handles the GitHub client secret.
  // It gets the same type-aware TS rule set as src/ (no-floating-promises,
  // no-misused-promises, no-unsafe-*, …) but none of the React/jsx-a11y/
  // import-boundary rules, which don't apply to this package.
  {
    files: ['worker/src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './worker/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsRecommendedTypeCheckedRules,
      // See the matching src/ block above for why only these three
      // strict-type-checked rules are enabled rather than the whole preset.
      '@typescript-eslint/no-unnecessary-condition': [
        'error',
        { allowConstantLoopConditions: true },
      ],
      '@typescript-eslint/no-deprecated': 'error',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // src/debug/ is developer-only tooling (never shipped to end users), so
  // jsx-a11y's recommended checks don't apply there.
  {
    files: ['src/debug/**/*.{ts,tsx}'],
    rules: Object.fromEntries(
      Object.keys(jsxA11yPlugin.flatConfigs.recommended.rules).map(rule => [rule, 'off']),
    ),
  },

  // Within a module, relative imports into its own subdirectories (e.g.
  // editor/ importing './dialogs/RepeatDialog') are ordinary internal
  // structure, not a boundary violation — the no-restricted-paths zones above
  // are what enforce the actual module boundary, and are not suppressed by
  // this override.
  {
    files: MODULES.flatMap(dir => [`src/${dir}/**/*.{ts,tsx}`]),
    rules: { 'import-x/no-internal-modules': 'off' },
  },

  // The global app store (src/store.ts) and the Dexie database
  // (src/storage/cache/db.ts) are each singletons: exactly one file may import
  // their underlying library. Everything else goes through @/storeBridge and
  // the functions exported by src/storage/cache/{files,credentials,registry}.ts,
  // which reach IndexedDB only through db.ts's cacheInit(). Scoping this to
  // db.ts rather than the whole cache/ directory is deliberate: it keeps the
  // singleton guarantee while letting the persistence concerns live in
  // separate files. Do NOT widen it to src/storage/cache/** — that dissolves
  // the guarantee with lint still green.
  // src/calendar/viewState.ts is a second, deliberately separate
  // Zustand store scoped to calendar-view-local ephemeral state (scroll
  // position, carousel previews) — not the global store, so it's exempted
  // here too, but it must still be reached through the @/calendar barrel like
  // any other feature-internal state (enforced by no-restricted-paths above).
  // Machine-enforces what was previously only a convention.
  //
  // ORDERING: this block must stay ABOVE the src/model/** block below. Flat
  // config replaces a rule's options wholesale rather than merging them, so a
  // later block naming this same rule id would silently drop model's own
  // restriction list (react, @/store, @/storage, ...). model's list therefore
  // repeats `zustand` and `dexie` itself.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/store.ts', 'src/storage/cache/db.ts', 'src/calendar/viewState.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'zustand', message: 'Only src/store.ts may import zustand. Use @/store or @/storeBridge.' },
            { name: 'dexie',   message: 'Only src/storage/cache/db.ts may import dexie. Use the functions exported by @/storage/cache/{files,credentials,registry}.' },
          ],
          patterns: [
            { group: ['zustand/*'], message: 'Only src/store.ts may import zustand. Use @/store or @/storeBridge.' },
            { group: ['dexie/*'],   message: 'Only src/storage/cache/db.ts may import dexie. Use the functions exported by @/storage/cache/{files,credentials,registry}.' },
          ],
        },
      ],
    },
  },

  // model/ is the domain core and must stay framework-free — no React, and
  // no outward dependency on store/storage/UI layers. This makes the
  // "model has no outward dependencies" invariant machine-enforced instead
  // of just documented (previously violated by a React hook that had
  // leaked in). model/ may only import @/types, @/fileIO, and @/wikilinks.
  {
    files: ['src/model/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'model/ is the pure domain core and must not depend on React.',
            },
            {
              name: 'zustand',
              message: 'model/ is the pure domain core and must not depend on the store.',
            },
            {
              name: 'dexie',
              message: 'model/ is the pure domain core and must not depend on storage.',
            },
            {
              name: '@/store',
              message: 'model/ is the pure domain core and must not depend on the store.',
            },
            {
              name: '@/storeBridge',
              message: 'model/ is the pure domain core and must not depend on the store.',
            },
            {
              name: '@/storage',
              message: 'model/ is the pure domain core and must not depend on storage.',
            },
            {
              name: '@/editor',
              message: 'model/ is the pure domain core and must not depend on editor/.',
            },
            {
              name: '@/calendar',
              message: 'model/ is the pure domain core and must not depend on calendar/.',
            },
          ],
          patterns: [
            {
              group: ['react-dom', 'react-dom/*', 'react/*'],
              message: 'model/ is the pure domain core and must not depend on React.',
            },
          ],
        },
      ],
    },
  },

  // Core persistence (storeCommit.ts, occurrenceActions.ts) must call the
  // persistencePort abstraction rather than @/storage directly — the storage
  // adapter registers the implementation at startup. Machine-enforces the
  // "core persistence goes through the port" invariant.
  {
    files: ['src/storeCommit.ts', 'src/occurrenceActions.ts'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: ['./src/storeCommit.ts', './src/occurrenceActions.ts'],
              from: './src/storage',
              message: 'Core persistence must go through @/persistencePort, not @/storage directly.',
            },
          ],
        },
      ],
    },
  },

  // ExampleBackend and the sync-collision/sync tests' FakeBackend +
  // in-memory cache/storeBridge mocks are deliberately synchronous (no real
  // I/O to await) — the `async` keyword is there only so their signatures
  // structurally match the Promise-returning contracts they stand in for,
  // not because they ever await anything.
  {
    files: [
      'src/storage/exampleBackend.ts',
      'src/storage/__tests__/sync-collision.test.ts',
      'src/storage/__tests__/sync.test.ts',
      'src/storage/__tests__/fs.test.ts',
      'src/storage/__tests__/vaultRegistry.test.ts',
      'src/storage/__tests__/githubOAuth.test.ts',
    ],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },

  // The test doubles for GitHubTokenExchanger are deliberately synchronous
  // (no real network I/O to await) — `async` is there only so their
  // signatures structurally match the Promise-returning contract, not
  // because they ever await anything.
  {
    files: ['worker/src/oauthToken.test.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
]
