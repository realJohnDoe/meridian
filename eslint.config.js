import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importXPlugin from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

const BARREL_DIRS = ['calendar', 'components', 'editor', 'hooks', 'model', 'onboarding', 'routes', 'search', 'storage']

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
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

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
          zones: BARREL_DIRS.map(protected_ => ({
            target: BARREL_DIRS.filter(d => d !== protected_).map(d => `./src/${d}`),
            from: `./src/${protected_}`,
            // components/ui/ is the shadcn primitive layer — always allowed as deep imports.
            except: protected_ === 'components'
              ? ['./index.ts', './index.tsx', './ui']
              : ['./index.ts', './index.tsx'],
            message: `Import from @/${protected_} barrel (index.ts), not from its internals.`,
          })),
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
