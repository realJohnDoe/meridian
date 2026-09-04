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

    // Count `import type` as an edge, so the rule above sees *design* cycles
    // and not only load-order ones.
    //
    // The default (`false`) reports post-compilation dependencies, which drops
    // type-only imports because tsc erases them — a defensible setting if the
    // only thing you fear is the half-initialised-module bug at load time. It
    // is not the rule here. Two modules that name each other's types are
    // mutually dependent whatever the emitted JS looks like: neither can be
    // read, moved, tested or extracted without the other, which is most of
    // what having a module boundary was for. And the distinction is one
    // keystroke wide — deleting `type` from an import turns a tolerated loop
    // into a real one, with nothing to catch it.
    //
    // Both loops this flag surfaced when it was turned on were genuine
    // placement bugs of exactly that kind: `cache/db.ts` (the bottom of its
    // directory) naming the payload types of the consumers that import it, and
    // `agendaSections.ts`/`overduePool.ts` each reaching for a type the other
    // declared.
    tsPreCompilationDeps: true,

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
