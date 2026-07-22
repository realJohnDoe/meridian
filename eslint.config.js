import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importXPlugin from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import reactPlugin from '@eslint-react/eslint-plugin'
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y'

const BARREL_DIRS = ['calendar', 'components', 'editor', 'hooks', 'model', 'onboarding', 'routes', 'search', 'storage']

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
      reportUnusedDisableDirectives: false,
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
      // Each directory with an index.ts is a feature module. Code outside that
      // directory must import via the barrel, not from internal files.
      //
      // Two-rule strategy:
      // 1. no-internal-modules  — catches violations from root-level src/ files.
      //    Feature dirs turn this off below (so their own relative subdirectory
      //    imports don't fire as false positives), but the rule stays on globally.
      // 2. no-restricted-paths  — catches violations FROM within feature dirs
      //    (which have no-internal-modules off). One zone per protected module;
      //    the target lists every OTHER feature dir as the restriction source.
      //
      // Global exceptions (always allowed as deep imports):
      //   @/components/ui/**              — shadcn primitives, always consumed as deep paths.
      //   @/lib/**                        — utility leaf, no barrel (lib/ has no index.ts).
      //   react-dom/client                — node_modules deep import needed at the entry point.
      //   @testing-library/jest-dom/vitest — node_modules deep import; the subpath is how
      //     jest-dom registers its matchers on vitest's `expect` (see test-utils/setup.ts).
      'import-x/no-internal-modules': [
        'error',
        { allow: ['@/components/ui/**', '@/lib/**', 'react-dom/client', '@testing-library/jest-dom/vitest'] },
      ],

      // For each barrel module, forbid deep imports into it from any OTHER
      // feature dir. One zone per protected module.
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            ...BARREL_DIRS.map(protected_ => ({
              target: BARREL_DIRS.filter(d => d !== protected_).map(d => `./src/${d}`),
              from: `./src/${protected_}`,
              // components/ui/ is the shadcn primitive layer — always allowed as deep imports.
              except: protected_ === 'components'
                ? ['./index.ts', './index.tsx', './ui']
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
      reportUnusedDisableDirectives: false,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsRecommendedTypeCheckedRules,
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

  // Within-feature files may use relative imports into their own subdirectories.
  // The no-restricted-paths rule above still enforces cross-feature boundaries
  // (it is a separate rule and is not suppressed by this override).
  {
    files: BARREL_DIRS.flatMap(dir => [`src/${dir}/**/*.{ts,tsx}`]),
    rules: { 'import-x/no-internal-modules': 'off' },
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
