import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useStore } from '@/store'
import { isTourDone, markTourDone } from './tourState'
import { Button } from '@/components/ui/button'
import { useResetOnChange, useFocusTrap } from '@/hooks'

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
  // The tour is for someone who has not connected anything yet — which is now
  // "no writable vault is registered", not "the Tutorial vault is active".
  // Under multi-vault the Tutorial vault is always registered, so keying off
  // its presence would replay the tour forever.
  const hasRealVault = useStore(s => s.vaults.some(v => v.kind !== 'example'))
  const vaultLoading = useStore(s => s.vaultLoading)

  const [active, setActive] = useState(false)
  const [stepIndex, setStepIndex] = useState(0)
  const cardRef = useRef<HTMLDivElement>(null)

  // The card sits at z-tour over an app that stays visible and clickable on
  // purpose — the tour points at the agenda, the search bar and the sidebar it
  // opens for the last step — so it can't be a ResponsiveModal: radix's
  // backdrop would black out the very thing each step is pointing at. It still
  // owes a keyboard user the other half of `role="dialog" aria-modal`, so the
  // trap is explicit. Skip/Done (and Escape, below) are the ways out.
  useFocusTrap(cardRef, active)

  // A short spatial orientation only — concepts are taught by the vault notes
  // themselves (open "Welcome to Meridian"). Purely Next/Back: nothing
  // auto-advances, so trying the app out never desyncs or kills the tour.
  const steps = useMemo<Step[]>(() => [
    {
      title: 'Welcome to Meridian',
      body: 'Meridian keeps your notes, events, and tasks as plain Markdown files in a folder — called a vault — that you own. Here\'s a quick look at where things live.',
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
      body: 'Open the menu (☰) to switch between Agenda, Month, Week, and Day, reach your favorites, and manage vaults in Settings. That\'s it — explore freely.',
      before: async () => {
        navigateHome()
        setSidebarOpen(true)
        await sleep(350)
      },
    },
  ], [setSidebarOpen, navigateHome])

  // Auto-start once, before any real vault exists (never again after
  // Skip/Done). Gated on `vaultLoading` rather than `hasRealVault` alone:
  // `vaultLoading` starts `true` at store creation and flips to `false` once
  // the async restore settles, so that flip is a real change `useResetOnChange`
  // can catch on both a brand-new visit (nothing to restore) and a returning
  // one — checking `hasRealVault` alone would fire this on mount, before
  // restore has had a chance to populate `vaults`, misreading a returning
  // user as a newcomer.
  useResetOnChange([vaultLoading, hasRealVault], () => {
    if (!vaultLoading && !hasRealVault && !isTourDone()) {
      setActive(true)
    }
  })

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

  // Escape dismisses, like Skip. Bound to the card rather than the document
  // because the app behind stays interactive: an Escape aimed at something the
  // user opened on top (the search overlay has its own document-level
  // listener) must not close the tour out from under it as well. Focus is
  // trapped in the card, so an Escape meant for the tour always originates
  // here.
  useEffect(() => {
    const card = cardRef.current
    if (!active || !card) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss() }
    }
    card.addEventListener('keydown', onKeyDown)
    return () => card.removeEventListener('keydown', onKeyDown)
  }, [active, dismiss])

  // Run each step's before() side-effects (navigation, sidebar) on change.
  useEffect(() => {
    if (!active) return
    void steps[stepIndex]?.before?.()
  }, [active, stepIndex, steps])

  if (!active) return null

  const step = steps[stepIndex]
  if (!step) return null
  const isLast = stepIndex === steps.length - 1

  return (
    <>
      {/* Popover card — pinned to a safe on-screen position via responsive
          utilities: near-full-width above the search bar on mobile, a fixed
          320px card bottom-centered from `sm` up. Always within the viewport. */}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Tour: ${step.title}`}
        tabIndex={-1}
        className="fixed z-tour outline-none flex max-h-[70dvh] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-4 shadow-2xl
          inset-x-4 bottom-[calc(6rem_+_env(safe-area-inset-bottom,0px))]
          sm:inset-x-auto sm:left-1/2 sm:w-80 sm:-translate-x-1/2"
      >
        {/* Header row */}
        <div className="flex items-center justify-between">
          <span className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide">
            {stepIndex + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="text-2xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={dismiss}
            aria-label="Skip tour"
          >
            Skip
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-foreground leading-snug">{step.title}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between pt-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-sm text-muted-foreground"
            onClick={back}
            disabled={stepIndex === 0}
          >
            ← Back
          </Button>
          <Button
            variant="brand"
            size="sm"
            className="h-8 px-4 text-sm"
            onClick={isLast ? dismiss : advance}
          >
            {isLast ? 'Done' : 'Next →'}
          </Button>
        </div>
      </div>
    </>
  )
}
