import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importXPlugin from 'eslint-plugin-import-x'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import reactHooksPlugin from 'eslint-plugin-react-hooks'

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
      // Any directory with an index.ts is a feature module; external code must
      // import via that barrel, not from internal files. New barrels are enforced
      // automatically — no config change needed when a new index.ts is added.
      // Exception: @/components/ui/** are shadcn primitives intentionally used
      // as deep imports everywhere.
      'import-x/no-internal-modules': [
        'error',
        { allow: ['@/components/ui/**', 'react-dom/client'] },
      ],
    },
  },

  // Within-feature files can freely import their own internals
  {
    files: [
      'src/storage/**/*.{ts,tsx}',
      'src/editor/**/*.{ts,tsx}',
      'src/model/**/*.{ts,tsx}',
      'src/hooks/**/*.{ts,tsx}',
      'src/calendar/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/routes/**/*.{ts,tsx}',
      'src/search/**/*.{ts,tsx}',
      'src/onboarding/**/*.{ts,tsx}',
    ],
    rules: { 'import-x/no-internal-modules': 'off' },
  },
]
