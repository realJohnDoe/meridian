import { spawn } from 'node:child_process'

/**
 * Shared `vite preview` bootstrap for the browser-driven checks in this
 * directory (`layout-smoke.mjs`, `contrast-sweep.mjs`) — split out so a
 * second script can start the same server against the same build instead of
 * copy-pasting the process-management and readiness-polling logic.
 */

// 127.0.0.1 rather than localhost, on both sides: a CI runner with IPv6
// enabled resolves `localhost` to ::1 first, which a server bound to the IPv4
// loopback never answers.
export const HOST = '127.0.0.1'
export const PORT = 4183
export const BASE = `http://${HOST}:${PORT}/meridian`
const STARTUP_TIMEOUT_MS = 60_000

/**
 * Starts `vite preview` over the built `dist/`, and resolves once it actually
 * answers a request.
 *
 * Readiness is an HTTP poll rather than a match against the server's banner on
 * stdout. Scraping that was the first version and it was wrong twice over: it
 * couples the check to Vite's console format, and when it failed — as it did on
 * the first CI run — the only thing it could report was that 30 seconds had
 * passed, with the server's own output thrown away. Asking the server whether
 * it is up tests the thing that matters and keeps the output to say why not.
 */
export async function startPreview() {
  const child = spawn('pnpm', ['exec', 'vite', 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  // Kept whole, for the failure paths below — this is the only account of what
  // went wrong when the server never comes up in CI.
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  let exit = null
  child.on('exit', (code, signal) => { exit = signal ?? `code ${code}` })

  const died = () => new Error(
    `vite preview exited (${exit}) before serving ${BASE}. Did \`pnpm run build\` run first?\n` +
    `--- vite preview output ---\n${log || '(nothing)'}`,
  )

  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (exit !== null) throw died()
    try {
      // Any HTTP answer means the server is listening; the status is the app's
      // business, not the server's readiness.
      await fetch(`${BASE}/`)
      return child
    } catch {
      await new Promise(r => setTimeout(r, 250))
    }
  }
  child.kill()
  throw new Error(
    `vite preview never answered ${BASE} within ${STARTUP_TIMEOUT_MS / 1000}s.\n` +
    `--- vite preview output ---\n${log || '(nothing)'}`,
  )
}
