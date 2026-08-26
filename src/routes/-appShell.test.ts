import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * Keeps `_app`'s one-screen cap out of a percentage flex-basis.
 *
 * The document flows by default — html/body/#root/#app carry `min-height`
 * only, so the entry routes can scroll and hand keyboard avoidance back to the
 * browser (see index.css). `_app` is the one shell that must stay exactly one
 * screen tall and clip itself, because every scroller below it — the agenda's
 * virtualizer above all — scrolls its own element rather than the document.
 *
 * That makes the two halves a coupled pair. `_app`'s wrapper is a flex item of
 * `#app` (`display:flex; flex-direction:column`), so its *height* is the main
 * size, and a flex item's main size comes from `flex-basis`, not from
 * `height`. `flex-1` sets `flex-basis: 0%`, a percentage resolved against the
 * container's inner main size — and an indefinite `#app` cannot resolve it, so
 * it degrades to `content`: the wrapper sized to the agenda's full virtualized
 * spacer, `h-svh` never applied, and the document scrolled instead of the
 * agenda. The topbar scrolled away, rows started thousands of pixels down the
 * page, and scroll-to-today did nothing at all, since the agenda's own scroll
 * element had scrollHeight === clientHeight.
 *
 * jsdom has no layout engine, so no render test can catch that — and the same
 * markup is correct again the moment `#app` regains a definite height. What is
 * actually checkable is the pairing itself, which is what this asserts.
 */

const SRC = path.resolve(__dirname, '..')
const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf-8')
const appTsx = fs.readFileSync(path.join(SRC, 'routes', '_app.tsx'), 'utf-8')

/** The declarations of index.css's `#app{…}` rule. */
const appRule = /#app\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''

/** The className `_app.tsx` puts on its outermost wrapper (the SidebarProvider). */
const shellClasses = (/<SidebarProvider\s+className="([^"]*)"/.exec(appTsx)?.[1] ?? '').split(/\s+/)

describe('the _app shell', () => {
  it('caps itself at one screen and clips, since nothing above it does', () => {
    expect(shellClasses).toContain('h-svh')
    expect(shellClasses).toContain('overflow-hidden')
  })

  it('sizes #app by min-height, leaving its height indefinite', () => {
    expect(appRule).toMatch(/(^|;)\s*min-height:/)
    expect(appRule).not.toMatch(/(^|;)\s*height:/)
  })

  it('never expresses that cap through a percentage flex-basis', () => {
    // flex-1/flex-auto/flex-initial all set a 0% or auto-percentage basis;
    // basis-* sets one outright. Any of them outranks h-svh on the main axis.
    const basisSetting = shellClasses.filter(c => /^(flex-(1|auto|initial)|basis-)/.test(c))
    expect(basisSetting).toEqual([])
  })
})
