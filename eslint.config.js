import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importXPlugin from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

const BARREL_DIRS = ['calendar', 'components', 'editor', 'hooks', 'model', 'onboarding', 'routes', 'search', 'storage']

// react-hooks 'recommended-latest' includes the React Compiler's diagnostics
// (refs, set-state-in-effect, purity, immutability, …) alongside the two
// classic rules, at the preset's own severities: 'error' for everything
// actionable, 'warn' for exhaustive-deps, incompatible-library, and
// unsupported-syntax — rules that flag real but sometimes unfixable
// situations (e.g. a third-party hook whose API can't be memoized safely)
// rather than bugs to fix.
const reactHooksRules = reactHooksPlugin.configs['recommended-latest'].rules

export default [
  // Auto-generated files — skip entirely
  { ignores: ['src/routeTree.gen.ts'] },

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
    },
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksPlugin,
      'import-x': importXPlugin,
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: './tsconfig.app.json' }),
      ],
    },
    rules: {
      // ── React hooks ──────────────────────────────────────────────────────────
      ...reactHooksRules,

      // ── TypeScript ───────────────────────────────────────────────────────────
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
      //   @/components/ui/** — shadcn primitives, always consumed as deep paths.
      //   @/lib/**           — utility leaf, no barrel (lib/ has no index.ts).
      //   react-dom/client   — node_modules deep import needed at the entry point.
      'import-x/no-internal-modules': [
        'error',
        { allow: ['@/components/ui/**', '@/lib/**', 'react-dom/client'] },
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

  // Within-feature files may use relative imports into their own subdirectories.
  // The no-restricted-paths rule above still enforces cross-feature boundaries
  // (it is a separate rule and is not suppressed by this override).
  {
    files: BARREL_DIRS.flatMap(dir => [`src/${dir}/**/*.{ts,tsx}`]),
    rules: { 'import-x/no-internal-modules': 'off' },
  },
]
