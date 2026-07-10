import { afterEach } from 'vitest'

// Runs for every test file. Guarded so node-env (non-DOM) tests, which are
// most of the suite, pay no cost here.
if (typeof window !== 'undefined') {
  // jsdom 29 implements neither of these. ResponsiveModal (and anything using
  // useMediaQuery) calls window.matchMedia directly, so any render throws
  // without a stub. Default to "matches" for min-width queries so
  // ResponsiveModal renders the Radix Dialog branch, not the Vaul drawer.
  window.matchMedia ??= ((query: string) =>
    ({
      matches: query.includes('min-width'),
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia

  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method -- polyfill assignment, never called unbound
  Element.prototype.scrollIntoView ??= () => {}

  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup) // vitest globals are off, so RTL's auto-cleanup never registers
}
