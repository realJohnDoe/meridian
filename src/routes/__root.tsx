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

/**
 * Sentinel used to detect a color canvas refused to parse. Any value works as
 * long as it is not a color a theme would plausibly resolve to.
 */
const PARSE_PROBE = '#ff00ff'

/**
 * Normalizes any CSS <color> to a plain "#rrggbb" string, or null when the
 * value does not parse.
 *
 * Our themes are authored in oklch(), and both getComputedStyle() and
 * getPropertyValue() hand modern color syntax back as-authored rather than
 * downgrading it to legacy rgb(). <meta name="theme-color">'s own parser only
 * understands the legacy set, so an oklch() written straight through is
 * silently dropped and Android falls back to its own default. A 1x1 canvas
 * readback resolves any color space down to 8-bit sRGB — exactly the subset
 * that parser accepts.
 *
 * Canvas rejects an unparseable fillStyle *silently*, keeping whatever was set
 * before (default #000000). Left undetected that would hand back an accidental
 * black and recreate the very bar this code exists to prevent, so the assign is
 * probed rather than trusted.
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

// Android colors the status bar from this meta tag rather than from the page
// itself, so it must track the active theme or it stays on the static default
// from index.html for every theme but the dark one.
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
      const meta = document.querySelector('meta[name="theme-color"]')
      if (!meta) return
      // --background, *not* the html element's own background. html paints
      // --backdrop, the letterbox behind the 430px app column, which is only
      // ever visible on viewports wider than that column. On a phone the
      // column fills the width and what actually sits under the status bar is
      // the topbar (_app.tsx), painted bg-background and extended up into the
      // notch via safe-area-inset-top. Reading --backdrop matched the status
      // bar to a near-black (#000717 in the dark theme) that clashed with the
      // topbar directly below it.
      const hex = toHex(getComputedStyle(document.documentElement).getPropertyValue('--background'))
      if (hex) meta.setAttribute('content', hex)
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
