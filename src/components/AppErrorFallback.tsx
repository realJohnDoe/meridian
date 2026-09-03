import { AlertTriangle } from 'lucide-react'
import type { ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

// Router-level defaultErrorComponent (wired in main.tsx) — every route match,
// including root, is wrapped in its own CatchBoundary, so this is the single
// fallback for any render-time throw anywhere in the app. Without it a bad
// occurrence, frontmatter shape, or wikilink resolution white-screens the
// whole offline-first PWA with no recovery path.
export default function AppErrorFallback({ error, reset }: ErrorComponentProps) {
  console.error(error)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <AlertTriangle className="text-destructive" size={32} />
      <div className="space-y-1">
        <p className="text-base font-medium text-foreground">Something went wrong</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {error instanceof Error ? error.message : 'An unexpected error occurred.'}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={reset}>Try again</Button>
        <Button onClick={() => window.location.reload()}>Reload app</Button>
      </div>
    </div>
  )
}
