import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Keeps `_app`'s one-screen cap where it belongs, and expressed in a form flex
 * sizing cannot overrule.
 *
 * The document flows by default — html/body/#root/#app carry `min-height`
 * only, so the entry routes can scroll and hand keyboard avoidance back to the
 * browser (see index.css). `_app` is the one shell that must stay exactly one
 * screen tall and clip itself, because every scroller below it — the agenda's
 * virtualizer above all — scrolls its own element rather than the document.
 *
 * Two things have already gone wrong with that cap, and this pins both:
 *
 *  1. **It was expressed as `h-svh` on a `flex-1` element.** The shell is a
 *     flex item of `#app` (`display:flex; flex-direction:column`), so its
 *     *height* is the main size, and a flex item's main size comes from
 *     `flex-basis`, not from `height`. `flex-1` sets `flex-basis: 0%`, a
 *     percentage resolved against the container's inner main size — which an
 *     indefinite `#app` cannot resolve, so it degrades to `content`. The shell
 *     sized to the agenda's full virtualized spacer, `h-svh` never applied,
 *     and the document scrolled instead of the agenda. A `max-height` is
 *     immune: it clamps the used main size *after* flex resolution, so it
 *     holds whatever the basis did.
 *  2. **It lived on SidebarProvider**, a shadcn registry mirror. That made the
 *     invariant depend on upstream's base classes and on tailwind-merge
 *     collision semantics, neither of which this repo controls.
 *
 * jsdom has no layout engine, so no render test can catch either. What is
 * actually checkable is where the cap lives and what it is made of.
 */

const SRC = path.resolve(__dirname, '..')
const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf-8')
const appTsx = fs.readFileSync(path.join(SRC, 'routes', '_app.tsx'), 'utf-8')

/** The declarations of index.css's `#app{…}` rule. */
const appRule = /#app\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

/** The className on `_app`'s own outermost element — the shell that clips. */
const shellClasses = (/data-app-shell\s+className="([^"]*)"/.exec(appTsx)?.[1] ?? '').split(/\s+/)

/** The className `_app` hands the vendored SidebarProvider. */
const providerClasses = (/<SidebarProvider[^>]*?className="([^"]*)"/s.exec(appTsx)?.[1] ?? '').split(/\s+/)

describe('the _app shell', () => {
  it('caps itself at one screen and clips, since nothing above it does', () => {
    expect(shellClasses).toContain('h-svh')
    expect(shellClasses).toContain('overflow-hidden')
  })

  it('sizes #app by min-height, leaving its height indefinite', () => {
    expect(appRule).toMatch(/(^|;)\s*min-height:/)
    expect(appRule).not.toMatch(/(^|;)\s*height:/)
  })

  it('backs the cap with a max-height, which flex sizing cannot outrank', () => {
    expect(shellClasses).toContain('max-h-svh')
  })

  it('never expresses the cap through a percentage flex-basis', () => {
    // Defense in depth behind max-h-svh: flex-1/flex-auto/flex-initial all set
    // a 0%-or-auto basis and basis-* sets one outright, and any of them
    // outranks h-svh on the main axis.
    const basisSetting = shellClasses.filter(c => /^(flex-(1|auto|initial)|basis-)/.test(c))
    expect(basisSetting).toEqual([])
  })

  it('keeps the cap off the vendored SidebarProvider', () => {
    // components/ui is a shadcn registry mirror; the shell invariant must not
    // be an override of somebody else's base classes.
    const capping = providerClasses.filter(c => /^(h-svh|max-h-|overflow-)/.test(c))
    expect(capping).toEqual([])
  })
})
