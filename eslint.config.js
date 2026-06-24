import tsParser from '@typescript-eslint/parser'
import tsPlugin from '@typescript-eslint/eslint-plugin'
import importPlugin from 'eslint-plugin-import'
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
      // Suppress warnings for eslint-disable comments referencing rules not yet enabled
      reportUnusedDisableDirectives: false,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooksPlugin,
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
    },
    rules: {
      // no-relative-parent-imports is intentionally omitted: the @/ alias convention
      // already prevents ../.. style imports, and the TypeScript resolver would cause
      // false positives by resolving @/store to a parent-relative path.

      // Enforce feature barrels: external code must import from the barrel (index.ts),
      // not from internal files. Each feature dir gets a zone added here when it gains
      // an index.ts barrel. The matching override below exempts each dir's own files.
      'import/no-restricted-paths': [
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
    rules: { 'import/no-restricted-paths': 'off' },
  },
]
