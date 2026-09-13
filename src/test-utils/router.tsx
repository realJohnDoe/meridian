import type { ReactNode, AnchorHTMLAttributes } from 'react'

type LinkStubProps = {
  to: string
  params?: Record<string, string>
  children?: ReactNode
} & AnchorHTMLAttributes<HTMLAnchorElement>

/**
 * Stub for `@tanstack/react-router`'s `Link`, for tests that render bare with
 * no router mounted. Resolves `to`/`params` into the anchor `href` the real
 * `Link` would ultimately produce, so assertions can read where it points.
 */
export function linkStub({ to, params, children, ...rest }: LinkStubProps) {
  return (
    <a href={Object.entries(params ?? {}).reduce((path, [k, v]) => path.replace(`$${k}`, v), to)} {...rest}>
      {children}
    </a>
  )
}

/**
 * Stub for `@tanstack/react-router`'s `useNavigate`/`useRouter`, for tests
 * that assert on navigation or back-button calls. Spread the result into a
 * `vi.mock('@tanstack/react-router', ...)` factory.
 */
export function navigateStub<Navigate>({ navigate, back }: { navigate: Navigate; back: () => void }) {
  return {
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix -- mocking @tanstack/react-router's useNavigate, not defining a hook
    useNavigate: () => navigate,
    // eslint-disable-next-line @eslint-react/no-unnecessary-use-prefix -- mocking @tanstack/react-router's useRouter, not defining a hook
    useRouter: () => ({ history: { back } }),
  }
}
