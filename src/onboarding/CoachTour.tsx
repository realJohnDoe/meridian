import { useState, useEffect, useCallback, useMemo } from 'react'
import { useStore } from '@/store'
import { isTourDone, markTourDone } from './tourState'
import { Button } from '@/components/ui/button'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface Step {
  title: string
  body: string
  /** Side-effects to run before the step shows (navigation, sidebar). */
  before?: () => Promise<void> | void
}

interface Props {
  setSidebarOpen: (open: boolean) => void
  /** Navigate to the Agenda root (closes editor, clears search params). */
  navigateHome: () => void
}

export default function CoachTour({ setSidebarOpen, navigateHome }: Props) {
  const activeVaultId = useStore(s => s.activeVaultId)

  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)

  // A short spatial orientation only — concepts are taught by the vault notes
  // themselves (open "Welcome to Meridian"). Purely Next/Back: nothing
  // auto-advances, so trying the app out never desyncs or kills the tour.
  const steps = useMemo<Step[]>(() => [
    {
      title: 'Welcome to Meridian',
      body: 'Meridian keeps your notes, events, and tasks as plain Markdown files in a folder you own. Here\'s a quick look at where things live.',
      before: async () => {
        setSidebarOpen(false)
        navigateHome()
        await sleep(100)
      },
    },
    {
      title: 'Your Agenda',
      body: 'Dated tasks and events appear here, by day. Tap any card to open it — start with “Welcome to Meridian” to learn the ideas at your own pace.',
      before: async () => {
        setSidebarOpen(false)
        navigateHome()
        await sleep(200)
      },
    },
    {
      title: 'Search & create',
      body: 'Type in the search bar to find any note, event, or task — including undated ones. Tap + to create something new.',
      before: async () => {
        navigateHome()
        await sleep(150)
      },
    },
    {
      title: 'The menu',
      body: 'Open the menu (☰) to switch between Agenda, Month, and Day, reach your favorites, and manage vaults in Settings. That\'s it — explore freely.',
      before: async () => {
        navigateHome()
        setSidebarOpen(true)
        await sleep(350)
      },
    },
  ], [setSidebarOpen, navigateHome])

  // Auto-start once on the example vault (never again after Skip/Done)
  useEffect(() => {
    if (activeVaultId === 'example' && !isTourDone()) {
      setActive(true)
    }
  }, [activeVaultId])

  const advance = useCallback(() => {
    setStepIndex(i => i + 1)
  }, [])

  const back = useCallback(() => {
    setStepIndex(i => Math.max(0, i - 1))
  }, [])

  const dismiss = useCallback(() => {
    markTourDone()
    setActive(false)
    setSidebarOpen(false)
    navigateHome()
  }, [setSidebarOpen, navigateHome])

  // Run each step's before() side-effects (navigation, sidebar) on change.
  useEffect(() => {
    if (!active) return
    void steps[stepIndex]?.before?.()
  }, [active, stepIndex, steps])

  if (!active) return null

  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1

  return (
    <>
      {/* Popover card — pinned to a safe on-screen position via responsive
          utilities: near-full-width above the search bar on mobile, a fixed
          320px card bottom-centered from `sm` up. Always within the viewport. */}
      <div
        role="dialog"
        aria-label={`Tour: ${step.title}`}
        className="fixed z-[9002] flex max-h-[70dvh] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl
          inset-x-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom,0px))]
          sm:inset-x-auto sm:left-1/2 sm:w-80 sm:-translate-x-1/2"
      >
        {/* Header row */}
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
            {stepIndex + 1} / {steps.length}
          </span>
          <button
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            onClick={dismiss}
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1">
          <p className="text-[15px] font-semibold text-foreground leading-snug">{step.title}</p>
          <p className="text-[13px] text-muted-foreground leading-relaxed">{step.body}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-[13px] text-muted-foreground"
            onClick={back}
            disabled={stepIndex === 0}
          >
            ← Back
          </Button>
          <Button
            variant="brand"
            size="sm"
            className="h-8 px-4 text-[13px]"
            onClick={isLast ? dismiss : advance}
          >
            {isLast ? 'Done' : 'Next →'}
          </Button>
        </div>
      </div>
    </>
  )
}
