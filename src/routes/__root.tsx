import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'
import { startOfToday } from 'date-fns'
import { ThemeProvider, useTheme } from 'next-themes'
import { fmtISO } from '@/model'
import { restoreVaults, autoSyncTick, resetSyncBackoff, flushPendingPush } from '@/storage'
import { requestScrollToToday, setCurrentDate } from '@/calendar'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: Root,
})

/**
 * Maps each theme id to the class applied on <html>.
 *
 * next-themes resolves the `system` theme to the literal names `light` and
 * `dark`, so those two keys are what point `prefers-color-scheme` at our own
 * branded pair rather than at one of the borrowed editor palettes. Every
 * other entry maps an explicit theme id to its own class — including
 * `meridian`, so a `meridian_theme` already in localStorage keeps resolving
 * across this change.
 */
export const THEME_CLASS: Record<string, string> = {
  light:              'meridian-light',
  dark:               'meridian',
  meridian:           'meridian',
  'meridian-light':   'meridian-light',
  'tokyo-night':      'tokyo-night',
  'catppuccin-latte': 'catppuccin-latte',
  'catppuccin-mocha': 'catppuccin-mocha',
  'rose-pine-dawn':   'rose-pine-dawn',
  'solarized-light':  'solarized-light',
  'solarized-dark':   'solarized-dark',
  dracula:            'dracula',
}

/**
 * Selectable theme ids — every THEME_CLASS key except the two
 * `prefers-color-scheme` aliases, which are resolution targets rather than
 * themes a user picks. Derived rather than written out so the list and the
 * class map cannot drift apart.
 */
export const THEME_IDS = Object.keys(THEME_CLASS).filter(id => id !== 'light' && id !== 'dark')

/** Marks the one theme-color tag this module owns, so it is never confused
 *  with the static tags index.html ships. */
const SYNCED_ATTR = 'data-theme-synced'

/** Probe for detecting a color canvas refused to parse — see toHex(). Any
 *  value works as long as no theme would plausibly resolve to it. */
const PARSE_PROBE = '#ff00ff'

/**
 * Normalizes any CSS <color> to "#rrggbb", or null when it does not parse.
 *
 * Hex is not required by the spec — `content` takes any CSS <color>, oklch()
 * included — but it is the form every engine can read, so normalizing costs
 * nothing in compliance and buys compatibility. It also gamut-clamps: our
 * darkest surfaces sit fractionally outside sRGB, and the computed value for
 * those serializes with negative channels (`color(srgb -0.0006 …)`), which is
 * valid CSS but a poor thing to hand a status bar.
 *
 * Canvas rejects an unparseable fillStyle *silently*, keeping the previous
 * value, so the assignment is probed rather than trusted — otherwise a colour
 * that failed to parse would come back as an accidental #000000.
 */
function toHex(cssColor: string): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = PARSE_PROBE
  ctx.fillStyle = cssColor
  if (ctx.fillStyle === PARSE_PROBE && cssColor.trim().toLowerCase() !== PARSE_PROBE) return null
  ctx.fillRect(0, 0, 1, 1)
  const data = ctx.getImageData(0, 0, 1, 1).data
  return `#${Array.from(data.subarray(0, 3), v => v.toString(16).padStart(2, '0')).join('')}`
}

/**
 * The tag ThemeColorSync drives, created on first use.
 *
 * Placement is load-bearing, not cosmetic. To obtain a page's theme colour the
 * UA walks the theme-color elements *in tree order* and returns the first one
 * whose media matches, so this tag has to precede the static tags in
 * index.html: appended after them it would be dead weight, because their
 * prefers-color-scheme queries already match whenever the JS value differs
 * from the system appearance — exactly the case this exists to cover. It
 * carries no media attribute of its own, so once present it always wins.
 *
 * The static tags stay useful behind it: they paint the first frame before
 * React mounts, cover JS being unavailable, and — since a *parse failure* also
 * advances the algorithm to the next candidate — catch a value this hands over
 * that the UA cannot read.
 */
function syncedThemeColorMeta(): HTMLMetaElement {
  const existing = document.querySelector<HTMLMetaElement>(`meta[${SYNCED_ATTR}]`)
  if (existing) return existing

  const meta = document.createElement('meta')
  meta.setAttribute('name', 'theme-color')
  meta.setAttribute(SYNCED_ATTR, '')

  const first = document.querySelector('meta[name="theme-color"]')
  if (first?.parentNode) first.parentNode.insertBefore(meta, first)
  else document.head.appendChild(meta)
  return meta
}

/**
 * Points the OS status bar at the active theme's surface colour.
 *
 * A progressive enhancement, deliberately: rewriting a theme-color tag's
 * content is what the HTML standard prescribes — UAs must re-run the theme
 * colour algorithm when a theme-color element's content attribute changes — so
 * this is correct wherever that is implemented, and simply inert where it is
 * not. Firefox for Android is currently in the latter camp
 * (https://bugzil.la/1464696); it needs no special-casing here and will start
 * working on its own once that is fixed.
 */
function ThemeColorSync() {
  // `resolvedTheme` is the dependency that matters, not `theme`: on the
  // system setting `theme` stays the constant 'system' while the OS flipping
  // light/dark moves only `resolvedTheme`, and keying off `theme` alone would
  // leave the status bar painted for the previous appearance.
  const { theme, resolvedTheme } = useTheme()
  useEffect(() => {
    // next-themes applies the new theme's class in its own effect on
    // ThemeProvider, which — being our parent — commits *after* this effect
    // (React fires effects child-first). Reading the computed style here
    // would therefore always see the previous theme. Deferring to the next
    // frame lets that effect land first.
    const raf = requestAnimationFrame(() => {
      // --background is the app column and topbar; the topbar is what extends
      // up under the status bar via safe-area-inset-top. html itself paints
      // --backdrop, the letterbox behind the 430px column, which a phone never
      // shows — matching the bar to that reads as near-black.
      const hex = toHex(getComputedStyle(document.documentElement).getPropertyValue('--background'))
      if (hex) syncedThemeColorMeta().setAttribute('content', hex)
    })
    return () => cancelAnimationFrame(raf)
  }, [theme, resolvedTheme])
  return null
}

function Root() {
  // Tracks the calendar day the app was last known to be on, so a resume
  // after a multi-day background suspend (mobile PWAs freeze timers rather
  // than reload) can tell "today changed while we were away" from an
  // ordinary tab switch and re-scroll the agenda to today accordingly.
  const lastActiveDayRef = useRef(startOfToday().getTime())

  useEffect(() => {
    void restoreVaults()
    const intervalId = setInterval(autoSyncTick, 60_000)
    const onOnline = () => { resetSyncBackoff(); autoSyncTick() }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') {
        // Best-effort: push anything dirty before the tab is backgrounded (or
        // closed) instead of waiting up to 60s for the next autoSyncTick.
        // The next activation's own syncOnActivate() is the guarantee (its
        // pushDirty leg rescues whatever this missed) — this just narrows the
        // window in the common case.
        flushPendingPush()
        return
      }
      autoSyncTick()
      const day = startOfToday().getTime()
      if (day !== lastActiveDayRef.current) {
        lastActiveDayRef.current = day
        requestScrollToToday()
        // Also resets the cross-view "current date" (calendar/viewState.ts),
        // not just Agenda's own scroll target — otherwise resuming on Month
        // or Day after a multi-day suspend would leave the sidebar carrying
        // over whatever stale day was in view when the app was backgrounded.
        setCurrentDate(fmtISO(new Date(day)))
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    // visibilitychange doesn't always fire reliably before a tab/PWA is
    // actually torn down (notably iOS Safari) — pagehide is the more reliable
    // "about to go away" signal, so back it up here too.
    window.addEventListener('pagehide', flushPendingPush)
    return () => {
      clearInterval(intervalId)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('pagehide', flushPendingPush)
    }
  }, [])

  return (
    <ThemeProvider
      attribute="class"
      themes={THEME_IDS}
      value={THEME_CLASS}
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="meridian_theme"
    >
      <ThemeColorSync />
      <div id="app" className="flex flex-col">
        <Outlet />
      </div>
      <Toaster />
    </ThemeProvider>
  )
}
