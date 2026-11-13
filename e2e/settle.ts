import type { Page } from '@playwright/test'

/** Consecutive identical animation frames that count as "stopped moving". */
const STABLE_FRAMES = 10

/**
 * Resolves once the layout the test is about to read has stopped changing: a
 * snapshot of the running finite animations/transitions, scroll offsets, the document height, the topbar height
 * and the mounted virtualized rows (count + first row's top) is identical across
 * STABLE_FRAMES consecutive animation frames. Replaces fixed
 * `waitForTimeout` sleeps. "The element exists" is not enough — a row mid-glide
 * (calendar/useVirtualFlip.ts) or a panel mid-transition exists but is still
 * moving.
 *
 * Polls requestAnimationFrame, which still runs in real time under
 * `page.clock.setFixedTime` (contrast-sweep) — never use `page.clock.install()`.
 */
export async function waitForStableLayout(page: Page): Promise<void> {
  await page.evaluate(stableFrames => new Promise<void>(resolve => {
    const snapshot = () => {
      const rows = [...document.querySelectorAll('[data-flip-key]')]
      const topbar = document.querySelector('[data-topbar]')
      // Colour/panel CSS transitions and finite animations don't move layout but must also be done
      // before a test reads computed colours (contrast-sweep).
      const transitions = document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity).length
      // Scroll offsets: views scroll themselves to "now" after mounting.
      const scrolls = [...document.querySelectorAll('*')].filter(e => e.scrollTop > 0).map(e => e.scrollTop)
      return JSON.stringify([
        scrolls,
        transitions,
        document.documentElement.scrollHeight,
        topbar ? topbar.getBoundingClientRect().height : null,
        rows.length,
        rows[0] ? rows[0].getBoundingClientRect().top : null,
      ])
    }
    let last = snapshot()
    let n = 0
    const tick = () => {
      const now = snapshot()
      n = now === last ? n + 1 : 0
      last = now
      if (n >= stableFrames) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }), STABLE_FRAMES)
}
