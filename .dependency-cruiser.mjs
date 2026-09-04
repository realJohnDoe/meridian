/**
 * Whole-graph import rules — the half of the architecture that ESLint can't see.
 *
 * ESLint is per-file: `no-restricted-paths` can say "components/ may not import
 * storage/", but nothing about a *loop* spanning six files, because no single
 * file in a cycle is wrong on its own. dependency-cruiser builds the whole
 * module graph first, so it can.
 *
 * `import-x/no-cycle` was tried first and does not work in this project: it
 * closes a cycle by string-matching ESLint's `physicalFilename` against the
 * path its resolver returns, and any custom resolver's normalisation breaks
 * that match. Since nearly every internal import here goes through the `@/`
 * alias — which *requires* the TS resolver — the rule passes cleanly while
 * seeing almost nothing. Verified by ablation, not assumed; see git history
 * for `plans/import-cycles.md`.
 */
export default {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A module ends up importing itself, directly or through others. At load time one of ' +
        'them necessarily runs against a half-initialised copy of the next, so the bug this ' +
        'produces is order-dependent, silent under a bundler that happens to hoist favourably, ' +
        'and fatal under one that does not. Break the loop: move the shared piece down into a ' +
        'leaf both sides may import, or invert the back-edge (return a value the caller acts ' +
        'on, rather than calling back up). CLAUDE.md invariant 4 has the standing rule; there ' +
        'are no accepted cycles.',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // Only our own source. node_modules is followed far enough to resolve, but
    // never reported on. `.test.ts(x)` files are deliberately left *in*: they
    // ship nowhere, but a loop through `test-utils/` is the same load-order
    // hazard under vitest that it would be in the bundle, and there is no
    // reason to be laxer here than in src/.
    includeOnly: '^src/',
    doNotFollow: { path: 'node_modules' },

    // Resolves the `@/*` path alias exactly as vite and tsc do.
    tsConfig: { fileName: 'tsconfig.app.json' },

    // The graph we care about is the *runtime* one. `false` here means
    // dependency-cruiser reports post-compilation dependencies, so an
    // `import type` — erased by tsc, present in no bundle — is not an edge.
    // This is the distinction madge does not make, and the reason two of the
    // "cycles" the original audit turned up were never cycles at all.
    tsPreCompilationDeps: false,

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },

    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
}
