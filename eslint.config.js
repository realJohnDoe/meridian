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
      // Enforce feature barrels: external code must import from the barrel (index.ts),
      // not from internal files. Each feature dir gets a zone added here when it gains
      // an index.ts barrel. The matching override below exempts each dir's own files.
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src',
              from: './src/storage',
              except: ['./index.ts'],
              message: "Import from '@/storage' (the barrel), not from storage internals",
            },
            {
              target: './src',
              from: './src/editor',
              except: ['./index.ts'],
              message: "Import from '@/editor' (the barrel), not from editor internals",
            },
          ],
        },
      ],
    },
  },

  // Within-feature files can freely import their own internals
  {
    files: ['src/storage/**/*.{ts,tsx}', 'src/editor/**/*.{ts,tsx}'],
    rules: { 'import-x/no-restricted-paths': 'off' },
  },
]
