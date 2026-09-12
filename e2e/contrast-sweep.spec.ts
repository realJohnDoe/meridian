import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { test, expect } from '@playwright/test'
import { BASE_URL } from '../playwright.config'

/**
 * Contrast sweep — issue #1005. Samples the *rendered* text/background pixel
 * pair for every text-bearing element, across every theme and a representative
 * set of routes, and asserts each (theme, route) combo against its own ratchet
 * floor (`FLOOR` below).
 *
 * Ratcheted per combo, not a single global count: eleven merged PRs (#302,
 * #329, #331, #340, #445, #478, #801, #912, #924, #930, #954) already fixed
 * contrast one finding at a time, with no standing check to catch the next
 * one. Landing this against an unknown number of pre-existing violations and
 * failing the build on day one is how a check gets disabled instead of fixed
 * — see #663 before #756 in this repo's own history for the same ratchet
 * shape applied to lint warnings. It ran report-only first (PR #1012) to
 * establish the baseline (4896 samples checked, 295 below WCAG AA), then a
 * single global `MAX_VIOLATIONS` floor (PR #1013). This file replaces that
 * one number with a floor *per combo*, so a regression in one (theme, route)
 * can no longer hide behind an unrelated improvement in another — each combo
 * is its own `test()`, asserting only against its own count. When a combo's
 * count drops below its floor, that test logs the new number to ratchet
 * `FLOOR` down to.
 *
 * ## Why not axe-core
 *
 * Verified before writing this: axe-core (4.12.1, run in a real page via
 * `axe.run(..., { runOnly: ['color-contrast'] })`) does not merely report
 * `incomplete` on the tinted chips this app uses (`bg-primary/30` and
 * friends, `src/components/ui/badge.tsx`'s `link`/`chip` variants) — it marks
 * the `color-contrast` rule `inapplicable` on them, with zero nodes in every
 * bucket (violations/incomplete/passes/inapplicable all silent). That is
 * *worse* than the "incomplete is indistinguishable from silence" case the
 * issue predicted: a wrapper that only checks `violations` (most do) sees
 * nothing, and even one that also checks `incomplete` sees nothing, because
 * axe's own background-color resolution throws these tokens out before
 * either bucket. `src/index.css` composites through oklab()-based
 * `color-mix()` — the value a modern Chromium reports back for these
 * properties is itself an oklab()/lab() function, not `rgb()`/`rgba()`, and
 * axe's color resolver doesn't parse that. Sampling the rendered pixel
 * sidesteps both problems: it never asks a color-mix() chain to resolve to a
 * single token, and it never depends on which serialization a computed style
 * happens to come back in.
 *
 * ## Shape
 *
 * For each theme (`THEME_IDS`, extracted from `THEME_CLASS` below rather than
 * imported — parsed at module scope so the (theme, route) pairs can be
 * generated before the `test()` loop, same as any parameterized Playwright
 * suite) × each route:
 *
 *   1. Set `localStorage.meridian_theme` before the page's own scripts run
 *      (`context.addInitScript`, applies to this test's isolated context) —
 *      the deterministic way into next-themes' `class` strategy, matching
 *      `routes/__root.tsx`'s `storageKey`.
 *   2. Collect every element with a direct (non-whitespace) text-node child:
 *      its viewport-clipped rect, font-size/weight (for the WCAG large-text
 *      threshold), and its *computed* `color` — resolved to concrete sRGB via
 *      a 1x1 canvas rather than string-parsed, exactly because computed
 *      `color` can come back as `oklab()`/`lab()` and canvas is the one thing
 *      guaranteed to resolve any CSS <color> the same way the page painted
 *      it. Drawn over both black and white backdrops so alpha can be solved
 *      for algebraically too (`text-muted-foreground/70` and friends are real
 *      in this codebase — `sidebar.tsx`, `select.tsx` — so text color here is
 *      not always fully opaque).
 *   3. Screenshot the viewport once as rendered.
 *   4. Inject a stylesheet that blanks every element's *ink* — `color`,
 *      `-webkit-text-fill-color`, `text-shadow`, `caret-color`,
 *      `text-decoration-color` — but touches no `background-*` property, so
 *      layout and every composited background stay pixel-identical.
 *      Screenshot again: this second frame is the background *as the text
 *      sits on top of it*, with the ink itself removed.
 *   5. For each element's rect, crop the second screenshot and take the mode
 *      of its (lightly quantized) pixel colors — robust against anti-aliased
 *      edges and border hairlines without needing to know which CSS layer
 *      produced the color.
 *   6. If the text color's own alpha is <1 (step 2), composite it over that
 *      sampled background before computing the ratio — same math the browser
 *      used to paint it.
 *
 * Known gap, not attempted here: an ancestor's `opacity-<n>` (past/done
 * occurrence cards use `opacity-60`) dims what's actually painted on screen
 * below the element's own computed `color`, and this reads computed `color`
 * rather than diffing the two screenshots pixel-for-pixel to recover it — so
 * a dimmed element's reported ratio can read slightly better than what a user
 * sees. Flagging it rather than silently shipping it: fixing it means
 * sampling the *text* pixels from screenshot 1 the same way step 5 samples
 * background pixels from screenshot 2, which is a reasonable follow-up but
 * more machinery than issue #1005 asked for.
 *
 * Single desktop viewport, deviceScaleFactor 1 (not layout-smoke's two —
 * contrast doesn't turn on breakpoint geometry the way layout does, and
 * DSF 1 keeps CSS px and screenshot px identical, which is what lets
 * `getBoundingClientRect()` index straight into the decoded PNG with no
 * scaling math). Set globally in `playwright.config.ts`.
 *
 * Run with `pnpm run test:e2e` (needs `pnpm run build` first, same as
 * `layout-smoke.spec.ts` — it serves the same `dist/` through the same
 * `webServer`).
 */

/**
 * Extracted from `src/routes/__root.tsx`'s `THEME_CLASS` rather than
 * imported (Playwright Test files run under esbuild-transpiled ESM, and
 * pulling in the whole app shell here would be its own kind of coupling) —
 * mirrors `THEME_IDS`'s own derivation (every key except the two
 * `prefers-color-scheme` resolution aliases) so this can't silently drift
 * from the map it's reading out of. `routes/__root.test.tsx` separately pins
 * `THEME_CLASS` against `THEMES`, so this only has one source to stay
 * in sync with.
 */
function extractThemeIds(): string[] {
  const rootPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'routes', '__root.tsx')
  const src = readFileSync(rootPath, 'utf8')
  const block = src.match(/export const THEME_CLASS: Record<string, string> = \{([\s\S]*?)\n\}/)?.[1]
  if (!block) throw new Error('extractThemeIds: could not find THEME_CLASS in __root.tsx — this extraction regex is stale')
  const ids = [...block.matchAll(/^\s*(?:'([^']+)'|([\w-]+)):/gm)].map(m => m[1] ?? m[2]!)
  const themeIds = [...new Set(ids)].filter(id => id !== 'light' && id !== 'dark')
  if (themeIds.length === 0) throw new Error('extractThemeIds: matched zero theme ids — this extraction regex is stale')
  return themeIds
}

/**
 * A representative route per shell (mirrors `layout-smoke.spec.ts`'s
 * APP_ROUTES/FLOW_ROUTES route set and `ready` selectors, so both checks
 * exercise the same known-good surface) — a smaller list than that file's:
 * `/entry/01-start-here` (a redirect to the same page as
 * `/entry/example/01-start-here`) and `/settings/vault/new` (a wizard, not
 * representative additional text) don't earn their own combo here.
 */
const ROUTES = [
  { path: '/', ready: '[data-testid="entry-card"]' },
  { path: '/backlog', ready: '[data-testid="entry-card"]' },
  { path: '/notes', ready: '[data-testid="entry-card"]' },
  { path: '/day/2026-09-04', ready: '[data-topbar]' },
  { path: '/week/2026-09-04', ready: '[data-topbar]' },
  { path: '/calendar/2026-09', ready: '[data-topbar]' },
  { path: '/entry/example/01-start-here', ready: '[data-flow-screen]' },
  { path: '/entry/new', ready: '[data-flow-screen]' },
  { path: '/settings', ready: '[data-flow-screen]' },
  { path: '/settings/appearance', ready: '[data-flow-screen]' },
  { path: '/settings/vault/example', ready: '[data-flow-screen]' },
]

/**
 * The ratchet floor, per (theme, route) — see the file doc comment. Set from
 * PR #1012's report-only baseline, broken out per combo instead of summed
 * into one number, and confirmed reproducible across three consecutive runs
 * against the same build before being turned into a gate (PR #1013). Lower
 * an entry whenever a fix drops that combo's count — the corresponding test
 * logs the new number to use.
 *
 * Re-baselined for #1026: the sweep now pins "today" (see the fixed clock
 * below) instead of drifting with the calendar, so every number here is
 * against 2026-09-04 specifically, not whatever date the floors were last
 * measured on. Two effects from that one change, both intentional:
 *  - meridian-light/catppuccin-latte/solarized-light dropped sharply (11-12
 *    to 2-3 on the six app routes) because darkening --muted-foreground
 *    (src/index.css) fixed the one token behind 12 of the original 13
 *    reported violations.
 *  - rose-pine-dawn rose (2 to 3 on the same six routes): pinning "today" to
 *    a date those routes actually render surfaced a real, previously-masked
 *    violation — the white-on-purple "today" day-badge — that a moving,
 *    usually-elsewhere "today" never used to land on a pinned route. Not
 *    fixed here, same reasoning as the "Calendar" chip below: a color-only
 *    fix risks legibility regressions this file's own contrast math can't
 *    catch (WCAG doesn't model chip-on-row compositing — see the on-accent
 *    text comments throughout this file), so it wants a deliberate look
 *    rather than a reflexive token nudge.
 */
const FLOOR: Record<string, Record<string, number>> = {
  meridian: {
    '/': 0, '/backlog': 0, '/notes': 0, '/day/2026-09-04': 0, '/week/2026-09-04': 0, '/calendar/2026-09': 0,
    '/entry/example/01-start-here': 0, '/entry/new': 0, '/settings': 0, '/settings/appearance': 0, '/settings/vault/example': 0,
  },
  'meridian-light': {
    '/': 2, '/backlog': 2, '/notes': 2, '/day/2026-09-04': 2, '/week/2026-09-04': 2, '/calendar/2026-09': 2,
    '/entry/example/01-start-here': 1, '/entry/new': 1, '/settings': 1, '/settings/appearance': 1, '/settings/vault/example': 1,
  },
  'tokyo-night': {
    '/': 1, '/backlog': 1, '/notes': 1, '/day/2026-09-04': 1, '/week/2026-09-04': 1, '/calendar/2026-09': 1,
    '/entry/example/01-start-here': 1, '/entry/new': 1, '/settings': 1, '/settings/appearance': 1, '/settings/vault/example': 1,
  },
  'catppuccin-latte': {
    '/': 3, '/backlog': 3, '/notes': 3, '/day/2026-09-04': 3, '/week/2026-09-04': 3, '/calendar/2026-09': 3,
    '/entry/example/01-start-here': 1, '/entry/new': 1, '/settings': 1, '/settings/appearance': 1, '/settings/vault/example': 1,
  },
  'catppuccin-mocha': {
    '/': 0, '/backlog': 0, '/notes': 0, '/day/2026-09-04': 0, '/week/2026-09-04': 0, '/calendar/2026-09': 0,
    '/entry/example/01-start-here': 0, '/entry/new': 0, '/settings': 0, '/settings/appearance': 0, '/settings/vault/example': 0,
  },
  'rose-pine-dawn': {
    '/': 3, '/backlog': 3, '/notes': 3, '/day/2026-09-04': 3, '/week/2026-09-04': 3, '/calendar/2026-09': 3,
    '/entry/example/01-start-here': 1, '/entry/new': 1, '/settings': 1, '/settings/appearance': 1, '/settings/vault/example': 1,
  },
  'solarized-light': {
    '/': 3, '/backlog': 3, '/notes': 3, '/day/2026-09-04': 3, '/week/2026-09-04': 3, '/calendar/2026-09': 3,
    '/entry/example/01-start-here': 1, '/entry/new': 1, '/settings': 1, '/settings/appearance': 1, '/settings/vault/example': 2,
  },
  'solarized-dark': {
    '/': 2, '/backlog': 2, '/notes': 2, '/day/2026-09-04': 2, '/week/2026-09-04': 2, '/calendar/2026-09': 2,
    '/entry/example/01-start-here': 1, '/entry/new': 1, '/settings': 1, '/settings/appearance': 1, '/settings/vault/example': 2,
  },
  dracula: {
    '/': 0, '/backlog': 0, '/notes': 0, '/day/2026-09-04': 0, '/week/2026-09-04': 0, '/calendar/2026-09': 0,
    '/entry/example/01-start-here': 0, '/entry/new': 0, '/settings': 0, '/settings/appearance': 0, '/settings/vault/example': 0,
  },
}

/** Stylesheet injected before the second screenshot — blanks ink, leaves every background untouched. */
const HIDE_INK_CSS = `
*, *::before, *::after {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
  caret-color: transparent !important;
  text-decoration-color: transparent !important;
}
`

interface CollectedElement {
  text: string
  tag: string
  cls: string
  textRGB: number[]
  textAlpha: number
  fontSize: number
  fontWeight: number
  rect: { x: number; y: number; w: number; h: number }
}

/**
 * Runs in-page. Resolves any CSS <color> (rgb/hex/oklch/oklab/lab/color-mix
 * results — whatever `getComputedStyle` happens to hand back) to concrete
 * sRGB plus its own alpha, by compositing it over two known opaque backdrops
 * and solving algebraically, rather than string-parsing. A 1x1 canvas is the
 * one thing guaranteed to resolve any CSS color the same way the page
 * painted it — see `toHex()` in `routes/__root.tsx` for the same trick used
 * for a single opaque color; this extends it to recover alpha too, since
 * Tailwind's text-color opacity modifier (`text-muted-foreground/70` and
 * friends — real in this codebase, see `sidebar.tsx`, `select.tsx`) makes
 * text color here not always fully opaque.
 */
function collectTextElementsInPage(): CollectedElement[] {
  function toRGBA(cssColor: string): { rgb: number[]; alpha: number } {
    function overBackdrop(hex: string): Uint8ClampedArray {
      const c = document.createElement('canvas')
      c.width = 1
      c.height = 1
      const ctx = c.getContext('2d')!
      ctx.fillStyle = hex
      ctx.fillRect(0, 0, 1, 1)
      ctx.fillStyle = cssColor
      ctx.fillRect(0, 0, 1, 1)
      return ctx.getImageData(0, 0, 1, 1).data
    }
    const overBlack = overBackdrop('#000000')
    const overWhite = overBackdrop('#ffffff')
    const perChannelAlpha = [0, 1, 2].map(i => 1 - (overWhite[i]! - overBlack[i]!) / 255)
    const alpha = Math.min(1, Math.max(0, perChannelAlpha.reduce((a, b) => a + b, 0) / 3))
    const rgb = alpha > 0.001
      ? [0, 1, 2].map(i => Math.min(255, Math.max(0, Math.round(overBlack[i]! / alpha))))
      : [overBlack[0]!, overBlack[1]!, overBlack[2]!]
    return { rgb, alpha }
  }

  const vw = window.innerWidth
  const vh = window.innerHeight

  /**
   * The element's rect intersected with every clipping ancestor's own rect,
   * walking up to <html> — NOT just `getBoundingClientRect()` clamped to the
   * window. A collapsed `grid-template-rows: 0fr` panel (the quick-nav
   * disclosure — CLAUDE.md's "Route shells" section) or an Embla carousel's
   * off-screen slide (`MonthStrip.tsx`, the search date picker) both clip a
   * descendant via an ancestor's `overflow: hidden`, but the descendant's own
   * `getBoundingClientRect()` keeps reporting its full, real, on-paper
   * geometry regardless — overflow clipping only changes what gets *painted*,
   * not the layout box a descendant reports about itself. Without this, a
   * genuinely invisible element (present in the DOM, zero painted pixels) got
   * checked anyway, its background sampled from whatever unrelated content
   * really occupies those screen coordinates — a false positive with no
   * connection to anything a user would ever see.
   */
  function visibleRect(el: Element): { x: number; y: number; w: number; h: number } | null {
    let clip = { left: 0, top: 0, right: vw, bottom: vh }
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const ncs = getComputedStyle(node)
      if (ncs.overflowX === 'visible' && ncs.overflowY === 'visible') continue
      const r = node.getBoundingClientRect()
      clip = {
        left: Math.max(clip.left, r.left), top: Math.max(clip.top, r.top),
        right: Math.min(clip.right, r.right), bottom: Math.min(clip.bottom, r.bottom),
      }
      if (clip.right <= clip.left || clip.bottom <= clip.top) return null
    }
    const rect = el.getBoundingClientRect()
    const x0 = Math.max(rect.left, clip.left)
    const y0 = Math.max(rect.top, clip.top)
    const x1 = Math.min(rect.right, clip.right)
    const y1 = Math.min(rect.bottom, clip.bottom)
    if (x1 <= x0 || y1 <= y0) return null
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  const out: CollectedElement[] = []
  for (const el of document.body.querySelectorAll('*')) {
    let hasDirectText = false
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0) { hasDirectText = true; break }
    }
    if (!hasDirectText) continue

    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) continue

    const rect = visibleRect(el)
    if (rect === null) continue

    const { rgb, alpha } = toRGBA(cs.color)
    out.push({
      text: (el.textContent ?? '').trim().slice(0, 60),
      tag: el.tagName.toLowerCase(),
      cls: el.className && el.className.toString ? el.className.toString().split(/\s+/).slice(0, 3).join(' ') : '',
      textRGB: rgb,
      textAlpha: alpha,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      rect,
    })
  }
  return out
}

/**
 * Mode of the (lightly quantized) pixel colors in `rect`, read from a
 * decoded PNG. Mode rather than mean: robust against anti-aliased edges and
 * border hairlines bleeding a handful of off-color pixels into a small rect,
 * where an average would skew toward them but the dominant color won't.
 * Quantized to the nearest 8 per channel so adjacent near-identical
 * anti-aliasing shades collapse into one bucket instead of splitting the
 * vote.
 */
function sampleModeColor(png: PNG, rect: { x: number; y: number; w: number; h: number }): number[] | null {
  const x0 = Math.max(0, Math.floor(rect.x))
  const y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(png.width, Math.ceil(rect.x + rect.w))
  const y1 = Math.min(png.height, Math.ceil(rect.y + rect.h))
  const counts = new Map<number, number>()
  const STEP = (x1 - x0) * (y1 - y0) > 400 ? 2 : 1 // subsample only once a rect is large enough for it to matter
  for (let y = y0; y < y1; y += STEP) {
    for (let x = x0; x < x1; x += STEP) {
      const idx = (png.width * y + x) * 4
      const r = png.data[idx]! >> 3 << 3
      const g = png.data[idx + 1]! >> 3 << 3
      const b = png.data[idx + 2]! >> 3 << 3
      const key = (r << 16) | (g << 8) | b
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  let bestKey: number | null = null
  let bestCount = -1
  for (const [key, count] of counts) if (count > bestCount) { bestCount = count; bestKey = key }
  if (bestKey === null) return null
  return [(bestKey >> 16) & 0xff, (bestKey >> 8) & 0xff, bestKey & 0xff]
}

function relLuminance([r, g, b]: number[]): number {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!)
}

function contrastRatio(rgbA: number[], rgbB: number[]): number {
  const lA = relLuminance(rgbA)
  const lB = relLuminance(rgbB)
  const [hi, lo] = lA > lB ? [lA, lB] : [lB, lA]
  return (hi! + 0.05) / (lo! + 0.05)
}

/** WCAG 2 AA: large text (>=24px, or >=18.66px/14pt at bold weight) needs 3:1; everything else needs 4.5:1. */
function aaThreshold(fontSizePx: number, fontWeight: number): number {
  const large = fontSizePx >= 24 || (fontWeight >= 700 && fontSizePx >= 18.66)
  return large ? 3.0 : 4.5
}

interface Failure {
  tag: string
  cls: string
  text: string
  fontSize: number
  fontWeight: number
  textRGB: number[]
  bgRGB: number[]
  ratio: number
  threshold: number
}

const themeIds = extractThemeIds()

for (const themeId of themeIds) {
  test.describe(themeId, () => {
    for (const { path: route, ready } of ROUTES) {
      test(route, async ({ page }) => {
        // Freeze "today" so routes that render relative to the current date
        // (`/`, `/backlog`, `/notes`) produce the same DOM — and the same
        // violation count — on every run, matching the three routes above
        // that already pin a literal date in their path. Without this, the
        // day-cell count on those three routes drifts with the calendar and
        // a fixed FLOOR can silently go from passing to failing with no code
        // change (#1026). Date-only (not setTimeout/rAF), so waitForTimeout
        // below still advances in real time.
        await page.clock.setFixedTime(new Date(2026, 8, 4, 12, 0, 0))
        await page.context().addInitScript(id => { localStorage.setItem('meridian_theme', id) }, themeId)
        await page.goto(`${BASE_URL}${route}`, { waitUntil: 'load' })
        await page.waitForSelector(ready, { timeout: 30_000 })
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(1500) // let transitions/virtualizer settle, matching layout-smoke.spec.ts

        const elements = await page.evaluate(collectTextElementsInPage)

        // Screenshot 2: same layout, ink blanked — background-only, since color
        // (unlike display/visibility) never triggers reflow.
        await page.addStyleTag({ content: HIDE_INK_CSS })
        const bgBuf = await page.screenshot({ type: 'png' })
        const bgPng = PNG.sync.read(bgBuf)

        const failures: Failure[] = []
        for (const el of elements) {
          const bgRGB = sampleModeColor(bgPng, el.rect)
          if (bgRGB === null) continue
          const textRGB = el.textAlpha >= 0.999
            ? el.textRGB
            : el.textRGB.map((c, i) => Math.round(el.textAlpha * c + (1 - el.textAlpha) * bgRGB[i]!))
          const ratio = contrastRatio(textRGB, bgRGB)
          const threshold = aaThreshold(el.fontSize, el.fontWeight)
          if (ratio < threshold) {
            failures.push({
              tag: el.tag, cls: el.cls, text: el.text,
              fontSize: el.fontSize, fontWeight: el.fontWeight,
              textRGB, bgRGB, ratio: Math.round(ratio * 100) / 100, threshold,
            })
          }
        }

        const floor = FLOOR[themeId]?.[route] ?? 0
        if (failures.length < floor) {
          console.log(`${themeId} ${route}: ${failures.length} is below the current floor of ${floor} — ratchet FLOOR[${JSON.stringify(themeId)}][${JSON.stringify(route)}] down to ${failures.length}.`)
        }

        const detail = failures
          .map(f => `  ${f.ratio}:1 (needs ${f.threshold}:1) <${f.tag} class="${f.cls}"> "${f.text}" — text rgb(${f.textRGB.join(',')}) on bg rgb(${f.bgRGB.join(',')}), ${f.fontSize}px/${f.fontWeight}`)
          .join('\n')
        expect(failures.length, `${failures.length} below WCAG AA, floor is ${floor}:\n${detail}`).toBeLessThanOrEqual(floor)
      })
    }
  })
}
