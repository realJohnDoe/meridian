import fs from 'fs'
import { resolve } from 'path'
import { defineConfig } from 'vite'

/**
 * The GitHub Pages site's last build: the teardown page that retires the old
 * origin (#1343, src/teardown/), in place of the app. `index.html` doubles as
 * `404.html`, so every old deep link lands on it too, and `sw.js` replaces the
 * installed service worker at the URL it was registered from.
 */
const ROOT = resolve(import.meta.dirname, 'src/teardown')
const OUT_DIR = resolve(import.meta.dirname, 'dist-teardown')

export default defineConfig({
  root: ROOT,
  base: '/meridian/',
  publicDir: false,
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: { index: resolve(ROOT, 'index.html'), sw: resolve(ROOT, 'sw.ts') },
      // Drops `sw.ts`'s exports: the registration being replaced is a classic
      // script, which cannot parse `import`/`export`.
      preserveEntrySignatures: false,
      output: { entryFileNames: chunk => chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js' },
    },
  },
  plugins: [{
    name: 'teardown-404',
    apply: 'build',
    closeBundle() {
      fs.copyFileSync(resolve(OUT_DIR, 'index.html'), resolve(OUT_DIR, '404.html'))
    },
  }],
})
