import { defineConfig } from 'vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
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

export default defineConfig({
  base: '/meridian/',
  plugins: [
    debugPagePlugin(),
    TanStackRouterVite({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Do not redirect debug.html navigations to index.html.
        // Without this, the NavigationRoute catches all navigations and serves
        // the main app instead of the debug page.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/meridian\/debug(\.html)?$/],
      },
      manifest: {
        name: 'Meridian',
        short_name: 'Meridian',
        description: 'A calm calendar and task app',
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
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
})
