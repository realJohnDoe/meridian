import { defineConfig } from 'vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { resolve } from 'path'
import fs from 'fs'
import type { Plugin } from 'vite'

/**
 * Serves debug.html at /meridian/debug.html (and /meridian/debug/) in dev mode.
 *
 * Why a custom plugin instead of Vite's built-in MPA mode: with base '/meridian/'
 * the VitePWA plugin's transformIndexHtml hook intercepts all HTML requests and
 * replaces the entry script with the main app's. We bypass that by injecting the
 * Vite HMR + React-refresh preamble manually and serving the file directly.
 */
function debugPagePlugin(): Plugin {
  return {
    name: 'debug-page',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (
          url === '/meridian/debug.html' || url === '/meridian/debug/' || url === '/meridian/debug' ||
          url === '/debug.html' || url === '/debug/' || url === '/debug'
        ) {
          try {
            // Read debug.html and inject Vite HMR + React-refresh manually,
            // bypassing the PWA plugin's transformIndexHtml hook which would
            // otherwise replace our entry script with the main app's script.
            let html = fs.readFileSync(resolve(__dirname, 'debug.html'), 'utf-8')
            const viteHead = [
              `<script type="module" src="/meridian/@vite/client"></script>`,
              `<script type="module">`,
              `  import RefreshRuntime from '/meridian/@react-refresh'`,
              `  RefreshRuntime.injectIntoGlobalHook(window)`,
              `  window.$RefreshReg$ = () => {}`,
              `  window.$RefreshSig$ = () => (type) => type`,
              `  window.__vite_plugin_react_preamble_installed__ = true`,
              `</script>`,
            ].join('\n')
            // Add base prefix to the entry script path
            html = html.replace(
              'src="/src/debug/main.tsx"',
              'src="/meridian/src/debug/main.tsx"',
            )
            html = html.replace('</head>', `${viteHead}\n  </head>`)
            res.setHeader('Content-Type', 'text/html; charset=utf-8')
            res.end(html)
          } catch (e) {
            next(e)
          }
          return
        }
        next()
      })
    },
  }
}

/**
 * Injects a strict Content-Security-Policy <meta> tag into the built index.html.
 *
 * Build-only (`apply: 'build'`): Vite's dev server injects CSS via inline
 * <style> tags for HMR, which `style-src` blocks with no way to relax just
 * for dev without weakening the shipped policy.
 *
 * `style-src` needs 'unsafe-inline': Radix UI (popovers/dialogs/tooltips),
 * @tanstack/react-virtual, vaul, and cmdk all set inline `style` attributes
 * via JS at runtime for positioning (transforms, offsets) — these change
 * per-render, so a static hash/nonce allowlist isn't viable. `script-src`
 * stays strict since that's what actually gates arbitrary code execution
 * (and therefore token exfiltration); CSS-only injection isn't a viable
 * channel to read IndexedDB and make network requests. `<meta>` CSP
 * delivery doesn't support frame-ancestors, report-uri, or sandbox —
 * omitted rather than silently ignored.
 */
function cspPlugin(): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    // codeload.github.com: the repo-archive (zipball) endpoint on api.github.com
    // 302-redirects here, and CSP is enforced against the redirected URL too — so
    // fetching a vault as an archive needs this host explicitly allowed.
    "connect-src 'self' https://api.github.com https://codeload.github.com https://meridian-oauth.realjohndoe.workers.dev",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')

  return {
    name: 'inject-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
      )
    },
  }
}

/**
 * Copies the built index.html to 404.html — the standard GitHub Pages
 * SPA-fallback trick. GitHub Pages does no server-side rewrites, so a fresh
 * top-level navigation to any client-only route (e.g. GitHub's OAuth redirect
 * landing on /meridian/auth/callback) hits the static file server directly and
 * 404s before our JS ever loads. Serving the same app shell for 404s means the
 * URL bar still shows the real path, and TanStack Router picks up routing
 * from there once the app boots.
 */
function spaFallbackPlugin(): Plugin {
  return {
    name: 'spa-404-fallback',
    apply: 'build',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist')
      fs.copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'))
    },
  }
}

export default defineConfig({
  base: '/meridian/',
  plugins: [
    debugPagePlugin(),
    cspPlugin(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true, routeFileIgnorePattern: '(^|/)index\\.tsx?$' }),
    react(),
    // babel-plugin-react-compiler auto-memoizes components/hooks at build time.
    // The react-hooks eslint preset (recommended-latest) already enforces the
    // same rules the compiler relies on, so the codebase is compiler-ready.
    babel({ presets: [reactCompilerPreset({ target: '19' })] }),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        cleanupOutdatedCaches: true,
        // Do not redirect debug.html navigations to index.html.
        // Without this, the NavigationRoute catches all navigations and serves
        // the main app instead of the debug page.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/meridian\/debug(\.html)?$/],
      },
      manifest: {
        name: 'Meridian',
        short_name: 'Meridian',
        description: 'A calm calendar, task manager, and notes app built on plain Markdown files.',
        theme_color: '#111318',
        background_color: '#111318',
        display: 'standalone',
        start_url: '/meridian/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
    spaFallbackPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // Align dep pre-bundling target with the build target. Without this, Vite's
  // optimizeDeps uses its own default (es2020/chrome87/…) and fails on packages
  // like sonner@2+ that use syntax only available in later environments.
  optimizeDeps: {
    rolldownOptions: {
      transform: {
        target: 'es2022',
      },
    },
  },
  build: {
    // The app uses File System Access API and Web Crypto — both require modern
    // browsers. Targeting es2022 / 2022-era browsers aligns with the actual
    // runtime requirements and is compatible with esbuild ≥0.28.
    target: ['es2022', 'chrome102', 'firefox102', 'safari16'],
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
      // A barrel (index.ts) re-exporting from a module that itself depends
      // (directly or transitively) back on that barrel silently produces
      // broken chunk execution order in production. Fail the build instead
      // of leaving it as a warning buried in build output. Scoped to this
      // specific code rather than the broader CIRCULAR_DEPENDENCY, which
      // also fires on harmless ESM cycles inside third-party packages we
      // don't control (e.g. @tanstack/router-core).
      onwarn(warning, warn) {
        if (warning.code === 'CYCLIC_CROSS_CHUNK_REEXPORT') {
          throw new Error(warning.message)
        }
        warn(warning)
      },
    },
  },
})
